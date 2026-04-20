-- =============================================================================
-- Operator REST API: per-API-key sliding-window rate limit events.
-- Migration: 20260420000004_operator_api_rate_limits.sql
--
-- Why a fresh table instead of reusing `rate_limit_buckets`?
-- ───────────────────────────────────────────────────────────
--  * The OAuth limiter (rate_limit_buckets) uses fixed windows — buckets
--    keyed by (bucket_key, window_start). That's a coarse anti-abuse
--    control where 2x burst at the boundary is acceptable.
--  * The Operator API has TWO concurrent limits (burst + sustained) and
--    we want a true sliding window so a leaked `wopr_` key can't drain
--    quota by aligning bursts with window edges. A simple event log
--    with `created_at` lets the service compute either window with one
--    `count(*) where created_at > now() - <interval>` per check.
--  * Keeping it isolated means we can prune aggressively (>1h old) and
--    iterate on the policy without touching the OAuth limiter.
--
-- Each row is ONE successful "I'm allowed to proceed" decision recorded
-- by `operator_rate_limit_service.checkApiRateLimit`. The row's
-- presence is what counts against future requests, not its content.
--
-- Storage envelope: the service prunes lazily on each check (rows older
-- than 1 hour cannot influence either the 1-min or 1-hour window), so
-- the table is bounded by `keys × max(sustained_limit) ≈ 300 rows/key`.
-- A workspace with 100 active keys peaks at 30k rows — small enough to
-- never warrant partitioning.
-- =============================================================================

CREATE TABLE public.operator_api_rate_limit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  uuid NOT NULL REFERENCES public.operator_api_keys(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The service's hot path is `count(*) WHERE api_key_id = ? AND created_at > ?`.
-- (api_key_id, created_at DESC) covers both the count query and the
-- prune query without a separate sort step.
CREATE INDEX operator_api_rate_limit_events_key_time_idx
  ON public.operator_api_rate_limit_events (api_key_id, created_at DESC);

ALTER TABLE public.operator_api_rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Writes go through the admin / service-role client only — the REST
-- entry point uses createAdminClient() because there is no auth.uid()
-- on a bearer-key request. We therefore intentionally publish NO
-- INSERT/UPDATE/DELETE policy for `authenticated`; service-role bypasses
-- RLS so it can write freely.
--
-- Read access: the owner of the key can SELECT their own events (so a
-- future "rate limit usage" panel in the keys management UI can render
-- without a service-role round-trip). The join through operator_api_keys
-- enforces ownership.
CREATE POLICY operator_api_rate_limit_events_owner_select
  ON public.operator_api_rate_limit_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.operator_api_keys k
      WHERE k.id = operator_api_rate_limit_events.api_key_id
        AND k.user_id = auth.uid()
    )
  );

-- Lazy prune helper: the service calls this opportunistically on each
-- rate-limit check. A row older than 1 hour cannot influence either the
-- 60s burst window or the 3600s sustained window, so deleting it is
-- safe and bounds table growth without a scheduled job.
CREATE OR REPLACE FUNCTION public.prune_operator_api_rate_limit_events(
  api_key_id_in uuid,
  older_than_seconds integer DEFAULT 3600
)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.operator_api_rate_limit_events
  WHERE api_key_id = api_key_id_in
    AND created_at < now() - (older_than_seconds || ' seconds')::interval;
$$;
