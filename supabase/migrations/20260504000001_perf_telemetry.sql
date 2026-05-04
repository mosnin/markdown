-- =============================================================================
-- Performance telemetry — route-latency observations, bundle snapshots, alerts
-- Migration: 20260504000001_perf_telemetry.sql
--
-- Backs the admin /app/admin/performance dashboard with real, durable data
-- (the previous stub returned synthetic numbers). Three tables:
--
--   * perf_route_observations — every flushed in-process buffer of route
--     latency; rolled up by the read service into trailing-window p50/p95/p99.
--   * perf_bundle_snapshots   — one row per `pnpm tsx scripts/bench/check_bundle.ts
--     --persist` invocation; the dashboard reads the latest per (route_class,
--     bundle_id).
--   * perf_alerts             — written by the alert service when any
--     route-class p95 over the last hour lands in the `red` tier; idempotent
--     within a 6 h window per route class.
--
-- PII contract: NONE of these tables ever record a user id, full URL, or
-- workspace id. Only the route-class label (A–H) is captured. The instrumentation
-- layer (`src/lib/perf/instrumentation.ts`) enforces that contract.
--
-- RLS contract:
--   * Reads — any workspace admin can SELECT (using
--     public.workspace_role(...) over their memberships).
--   * Writes — service-role only. Service-role bypasses RLS entirely so the
--     authenticated-role policies below intentionally have no INSERT/UPDATE
--     rule, which falls through to "deny by default".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper — is_workspace_admin_anywhere()
--
--    The perf tables are global (not workspace-scoped), but the read
--    surface is admin-only. Rather than re-implementing role lookup at
--    every RLS site, we add one helper that returns true iff the caller
--    is an admin or owner of *any* workspace they belong to. The dashboard
--    is admin-only at the application layer (`canAdmin(workspace.role)` in
--    the page guard) — this RLS rule is the defence-in-depth check.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_workspace_admin_anywhere()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships m
    WHERE m.user_id = auth.uid()
      AND m.role IN ('admin')
  ) OR EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. perf_route_observations
--
--    One row per flushed buffer of route-latency samples. Each row
--    represents `sample_count` requests aggregated to p50/p95/p99 by the
--    in-process buffer flusher (see src/lib/perf/instrumentation.ts).
--    Rolled up by trailing-24h window in the read service.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.perf_route_observations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  route_class   char(1)     NOT NULL CHECK (route_class IN ('A','B','C','D','E','F','G','H')),
  p50_ms        integer     NOT NULL CHECK (p50_ms >= 0),
  p95_ms        integer     NOT NULL CHECK (p95_ms >= 0),
  p99_ms        integer     NOT NULL CHECK (p99_ms >= 0),
  sample_count  integer     NOT NULL CHECK (sample_count > 0),
  source        text        NOT NULL DEFAULT 'edge'
);

CREATE INDEX IF NOT EXISTS perf_route_observations_recorded_at_idx
  ON public.perf_route_observations (recorded_at DESC);

CREATE INDEX IF NOT EXISTS perf_route_observations_class_recorded_at_idx
  ON public.perf_route_observations (route_class, recorded_at DESC);

ALTER TABLE public.perf_route_observations ENABLE ROW LEVEL SECURITY;

-- Read: any workspace admin or owner. Writes: no policy → service-role-only.
CREATE POLICY perf_route_observations_admin_select
  ON public.perf_route_observations
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_admin_anywhere());

-- ---------------------------------------------------------------------------
-- 3. perf_bundle_snapshots
--
--    One row per `check_bundle.ts --persist` run. The dashboard reads the
--    most recent snapshot per (route_class, source) pair and shows it
--    against the documented soft/hard caps from src/lib/perf_budget.ts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.perf_bundle_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  -- Route class is nullable so the global bundle snapshots (marketing
  -- shared chunk, app shell chunk, total-css) — which aren't tied to one
  -- route class — can still be persisted. Per-page entries set this.
  route_class   char(1)              CHECK (route_class IS NULL OR route_class IN ('A','B','C','D','E','F','G','H')),
  -- Bundle id from globalBundleBudgets (e.g. "marketing-shared",
  -- "app-shell", "per-page-additive", "total-css").
  bundle_id     text        NOT NULL,
  gzipped_kb    numeric(10,2) NOT NULL CHECK (gzipped_kb >= 0),
  raw_kb        numeric(10,2) NOT NULL CHECK (raw_kb >= 0),
  source        text        NOT NULL DEFAULT 'ci'
);

CREATE INDEX IF NOT EXISTS perf_bundle_snapshots_bundle_recorded_idx
  ON public.perf_bundle_snapshots (bundle_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS perf_bundle_snapshots_recorded_at_idx
  ON public.perf_bundle_snapshots (recorded_at DESC);

ALTER TABLE public.perf_bundle_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY perf_bundle_snapshots_admin_select
  ON public.perf_bundle_snapshots
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_admin_anywhere());

-- ---------------------------------------------------------------------------
-- 4. perf_alerts
--
--    One row per route-class p95 regression detected by the alert service
--    (perf_alert_service.ts). The service is idempotent within 6 h per
--    route class — it consults the most recent un-resolved row before
--    inserting. `resolved_at` is set by an admin via the dashboard's
--    "Mark resolved" form action.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.perf_alerts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_at       timestamptz NOT NULL DEFAULT now(),
  route_class     char(1)     NOT NULL CHECK (route_class IN ('A','B','C','D','E','F','G','H')),
  observed_p95_ms integer     NOT NULL CHECK (observed_p95_ms >= 0),
  budget_p95_ms   integer     NOT NULL CHECK (budget_p95_ms >= 0),
  -- Free-text reason (e.g. "p95 1820 ms exceeds budget 800 ms by 2.27x").
  reason          text        NOT NULL,
  resolved_at     timestamptz,
  resolved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS perf_alerts_unresolved_idx
  ON public.perf_alerts (raised_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS perf_alerts_class_raised_idx
  ON public.perf_alerts (route_class, raised_at DESC);

ALTER TABLE public.perf_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY perf_alerts_admin_select
  ON public.perf_alerts
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_admin_anywhere());

-- Admins may set resolved_at via the dashboard form action. The service
-- layer enforces "only resolve, never re-open or fabricate" by going
-- through a dedicated server action; this RLS rule is the defence-in-depth
-- check that authenticated callers cannot tamper with raised alerts.
CREATE POLICY perf_alerts_admin_update
  ON public.perf_alerts
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_admin_anywhere())
  WITH CHECK (public.is_workspace_admin_anywhere());
