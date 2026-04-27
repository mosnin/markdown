-- Phase 12 — Operator sessions (Codex-like thread management)
--
-- Each operator session groups a series of runs into a logical conversation
-- thread. This lets users maintain multiple independent agent contexts and
-- switch between them, combating context rot on long-running projects.
--
-- Sessions are workspace-scoped and user-scoped. RLS ensures users can only
-- see their own sessions. A session has a human-readable name (editable),
-- a run count (denormalized for fast list rendering), and a last_run_at
-- timestamp (updated whenever a new run is added to the session).

-- ─── Sessions table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_operator_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text        NOT NULL DEFAULT 'New session',
  run_count      integer     NOT NULL DEFAULT 0,
  last_run_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_workspace_user
  ON public.workspace_operator_sessions (workspace_id, user_id, created_at DESC);

-- Auto-update updated_at on row change
CREATE OR REPLACE TRIGGER trg_operator_sessions_updated_at
  BEFORE UPDATE ON public.workspace_operator_sessions
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ─── FK on runs table ─────────────────────────────────────────────────────────

ALTER TABLE public.workspace_operator_runs
  ADD COLUMN IF NOT EXISTS session_id uuid
    REFERENCES public.workspace_operator_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_operator_runs_session_id
  ON public.workspace_operator_runs (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.workspace_operator_sessions ENABLE ROW LEVEL SECURITY;

-- Users can see their own sessions in workspaces they belong to.
CREATE POLICY "Users can view own operator sessions"
  ON public.workspace_operator_sessions
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert sessions for themselves.
CREATE POLICY "Users can insert own operator sessions"
  ON public.workspace_operator_sessions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own sessions (rename, etc.).
CREATE POLICY "Users can update own operator sessions"
  ON public.workspace_operator_sessions
  FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own sessions.
CREATE POLICY "Users can delete own operator sessions"
  ON public.workspace_operator_sessions
  FOR DELETE
  USING (user_id = auth.uid());
