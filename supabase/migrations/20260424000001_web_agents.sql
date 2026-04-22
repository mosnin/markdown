-- Phase 5 — Web agents: deep research + stateful browsing.
--
-- Three new tables + one workspaces column:
--   1. web_tool_usage      — per-call billing log; source of truth for monthly spend
--   2. browsing_sessions   — stateful Browserbase sessions
--   3. browsing_session_steps — every action within a session
--   4. web_citations       — agent-response → source URL link for the citation UI
--   5. workspaces.web_tool_budget_cents — per-workspace monthly cap

-- ─── 1. web_tool_usage ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.web_tool_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tool_name text NOT NULL CHECK (
    tool_name IN (
      'exa_search',
      'tavily_search',
      'web_fetch',
      'browserbase_session',
      'browserbase_step'
    )
  ),
  units integer NOT NULL DEFAULT 1,
  cost_cents integer NOT NULL DEFAULT 0,
  operator_run_id uuid REFERENCES public.workspace_operator_runs(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_tool_usage_workspace_month
  ON public.web_tool_usage (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_web_tool_usage_operator_run
  ON public.web_tool_usage (operator_run_id)
  WHERE operator_run_id IS NOT NULL;

ALTER TABLE public.web_tool_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY web_tool_usage_member_select ON public.web_tool_usage
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = web_tool_usage.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Writes only through the service role (tool routes hit the DB with the admin client).

-- ─── 2. browsing_sessions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.browsing_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operator_run_id uuid REFERENCES public.workspace_operator_runs(id) ON DELETE SET NULL,
  browserbase_session_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'completed', 'failed', 'timed_out')
  ),
  goal text,
  live_url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error text,
  page_count integer NOT NULL DEFAULT 0,
  total_cost_cents integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_browsing_sessions_workspace
  ON public.browsing_sessions (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_browsing_sessions_active
  ON public.browsing_sessions (workspace_id)
  WHERE status = 'active';

ALTER TABLE public.browsing_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY browsing_sessions_member_select ON public.browsing_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = browsing_sessions.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ─── 3. browsing_session_steps ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.browsing_session_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.browsing_sessions(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  action text NOT NULL CHECK (
    action IN ('navigate', 'click', 'fill', 'extract', 'screenshot')
  ),
  url text,
  selector text,
  value text,
  extracted_content text,
  screenshot_url text,
  action_took_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_browsing_session_steps_session
  ON public.browsing_session_steps (session_id, step_number);

ALTER TABLE public.browsing_session_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY browsing_session_steps_member_select ON public.browsing_session_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.browsing_sessions s
      JOIN public.workspace_memberships wm
        ON wm.workspace_id = s.workspace_id
       AND wm.user_id = auth.uid()
      WHERE s.id = browsing_session_steps.session_id
    )
  );

-- ─── 4. web_citations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.web_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  operator_run_id uuid REFERENCES public.workspace_operator_runs(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN ('exa', 'tavily', 'browserbase', 'web_fetch')
  ),
  url text NOT NULL,
  title text,
  excerpt text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_citations_operator_run
  ON public.web_citations (operator_run_id)
  WHERE operator_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_web_citations_workspace
  ON public.web_citations (workspace_id, fetched_at DESC);

ALTER TABLE public.web_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY web_citations_member_select ON public.web_citations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = web_citations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ─── 5. Workspace budget column ──────────────────────────────────────────
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS web_tool_budget_cents integer NOT NULL DEFAULT 500;

COMMENT ON COLUMN public.workspaces.web_tool_budget_cents IS
  'Monthly cap on web-tool spend (Exa, Browserbase, web_fetch). Default $5.00. When the current-month web_tool_usage sum reaches this, the agent tool routes return 402 and Pog reports "budget exhausted".';
