-- Phase 8 — Workflow designer.
--
-- Five tables:
--   1. workflows           — saved workflow graphs
--   2. workflow_nodes      — one per node in a workflow
--   3. workflow_edges      — one per edge
--   4. workflow_runs       — one per execution
--   5. workflow_node_runs  — one per node execution within a run

-- ─── 1. workflows ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'active', 'archived')
  ),
  trigger_id uuid REFERENCES public.agent_triggers(id) ON DELETE SET NULL,
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace
  ON public.workflows (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflows_trigger
  ON public.workflows (trigger_id)
  WHERE trigger_id IS NOT NULL;

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflows_member_select ON public.workflows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = workflows.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ─── 2. workflow_nodes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  node_type text NOT NULL CHECK (
    node_type IN (
      'start',
      'subagent',
      'web_search',
      'web_fetch',
      'transform',
      'condition',
      'merge',
      'end'
    )
  ),
  position jsonb NOT NULL DEFAULT '{"x":0,"y":0}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow
  ON public.workflow_nodes (workflow_id);

ALTER TABLE public.workflow_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_nodes_member_select ON public.workflow_nodes
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.workflows w
      JOIN public.workspace_memberships wm
        ON wm.workspace_id = w.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = workflow_nodes.workflow_id
    )
  );

-- ─── 3. workflow_edges ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  target_node_id uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  source_handle text,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow
  ON public.workflow_edges (workflow_id);

ALTER TABLE public.workflow_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_edges_member_select ON public.workflow_edges
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.workflows w
      JOIN public.workspace_memberships wm
        ON wm.workspace_id = w.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = workflow_edges.workflow_id
    )
  );

-- ─── 4. workflow_runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  total_cost_cents integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
  ON public.workflow_runs (workflow_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workspace
  ON public.workflow_runs (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_active
  ON public.workflow_runs (status)
  WHERE status IN ('queued', 'running');

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_runs_member_select ON public.workflow_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = workflow_runs.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ─── 5. workflow_node_runs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_node_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.workflow_nodes(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'skipped')
  ),
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  subagent_invocation_id uuid REFERENCES public.subagent_invocations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_run
  ON public.workflow_node_runs (workflow_run_id);

CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_node
  ON public.workflow_node_runs (node_id, started_at DESC);

ALTER TABLE public.workflow_node_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_node_runs_member_select ON public.workflow_node_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_runs wr
      JOIN public.workspace_memberships wm
        ON wm.workspace_id = wr.workspace_id
       AND wm.user_id = auth.uid()
      WHERE wr.id = workflow_node_runs.workflow_run_id
    )
  );
