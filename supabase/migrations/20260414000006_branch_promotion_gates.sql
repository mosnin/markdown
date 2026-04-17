-- =============================================================================
-- Context Store — Branch promotion gates
-- Migration: 20260414000006_branch_promotion_gates.sql
--
-- Lightweight CI/CD-style webhook gates that run before a branch is
-- promoted. Workspace admins register one or more HTTP endpoints that
-- return `{ status: 'pass' | 'fail', reason?: string }`; each gate can
-- veto the promotion. Every invocation is recorded as a `gate_run` so
-- the branch detail UI can show pass/fail history.
--
-- Design notes:
--
--   * Gates are workspace-scoped. An admin in workspace A cannot list
--     or invoke gates belonging to workspace B.
--   * Each gate stores a server-generated 32-byte HMAC secret used to
--     sign outbound webhook requests. The secret is shown ONCE at
--     creation (and on rotate); we store it in plaintext here rather
--     than hashed because the server itself needs to sign with it on
--     every promote. It is still treated as sensitive: only admins can
--     read the column (see RLS below), and the rotate_secret path
--     regenerates it in one operation.
--   * A short per-gate timeout (default 10s) bounds the total promote
--     latency. The service enforces timeout + a small safety margin.
--   * Runs are immutable audit rows. The response body can contain
--     arbitrary webhook text — we keep them member-readable so the
--     branch detail page can render history without needing admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. branch_promotion_gates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.branch_promotion_gates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name            text        NOT NULL
                              CHECK (char_length(name) BETWEEN 1 AND 200),

  -- Full HTTPS URL the promote path POSTs to. Validated at the
  -- service layer (https-only, no loopback).
  webhook_url     text        NOT NULL,

  -- HMAC signing secret. 32 bytes of random, hex-encoded by the
  -- service layer. Shown once at creation; rotate to regenerate.
  secret          text        NOT NULL,

  -- Per-gate timeout (seconds). Runs that exceed this bound are
  -- recorded with status='timeout' and treated as a fail.
  timeout_seconds integer     NOT NULL DEFAULT 10
                              CHECK (timeout_seconds BETWEEN 1 AND 60),

  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'disabled')),

  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS branch_promotion_gates_ws_idx
  ON public.branch_promotion_gates (workspace_id)
  WHERE status = 'active';

CREATE TRIGGER branch_promotion_gates_set_updated_at
  BEFORE UPDATE ON public.branch_promotion_gates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.branch_promotion_gates ENABLE ROW LEVEL SECURITY;

-- Members can read gates in their workspace (so the pre-promote panel
-- on the branch detail page can render the gate list). Writes are
-- admin-only because misconfigured gates can block promotes.
CREATE POLICY branch_promotion_gates_member_select
  ON public.branch_promotion_gates
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY branch_promotion_gates_admin_insert
  ON public.branch_promotion_gates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY branch_promotion_gates_admin_update
  ON public.branch_promotion_gates
  FOR UPDATE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id))
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY branch_promotion_gates_admin_delete
  ON public.branch_promotion_gates
  FOR DELETE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 2. branch_promotion_gate_runs
--
--   Immutable audit rows. One per (gate, promote-attempt). `status`
--   starts as 'pending' when the request is dispatched and flips to
--   one of passed / failed / error / timeout when the response is
--   received (or the timeout fires). `response_body` stores up to a
--   few kilobytes of the webhook response for debugging; callers
--   truncate if necessary.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.branch_promotion_gate_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id         uuid        NOT NULL REFERENCES public.branch_promotion_gates(id) ON DELETE CASCADE,
  branch_id       uuid        NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,

  status          text        NOT NULL
                              CHECK (status IN ('pending', 'passed', 'failed', 'error', 'timeout')),

  -- Up to ~8KB of the response body (gate service truncates longer).
  response_body   text,

  -- Total wall-clock time from dispatch to terminal status.
  duration_ms     integer,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gate_runs_branch_idx
  ON public.branch_promotion_gate_runs (branch_id, created_at DESC);

ALTER TABLE public.branch_promotion_gate_runs ENABLE ROW LEVEL SECURITY;

-- Members can read runs (so the branch detail page can show the
-- pre-promote pass/fail history). Writes go through the promote
-- server action using the service-role admin client — no direct RLS
-- write is allowed because the rows are otherwise trivially
-- forgeable.
CREATE POLICY branch_promotion_gate_runs_member_select
  ON public.branch_promotion_gate_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.branch_promotion_gates g
      WHERE g.id = gate_id
        AND public.owns_workspace(g.workspace_id)
    )
  );
