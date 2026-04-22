-- Phase 6 — Sub-agents + skill plugins.
--
-- Extends `skills` with is_subagent / subagent_tools / subagent_max_turns so a
-- skill can be promoted to an invokable sub-agent. Adds `subagent_invocations`
-- to track every sub-agent call back-referenced to the parent orchestrator run.

-- ─── 1. Skills gain sub-agent columns ────────────────────────────────────
ALTER TABLE public.skills
  ADD COLUMN IF NOT EXISTS is_subagent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subagent_tools text[],
  ADD COLUMN IF NOT EXISTS subagent_max_turns integer;

-- Sanity bounds on max_turns (only checked when value is set)
ALTER TABLE public.skills
  ADD CONSTRAINT skills_subagent_max_turns_reasonable
    CHECK (subagent_max_turns IS NULL OR (subagent_max_turns BETWEEN 1 AND 100));

COMMENT ON COLUMN public.skills.is_subagent IS
  'When true, this skill is invokable as a sub-agent from the orchestrator (Pog). List_skills_plugins returns only skills with is_subagent=true.';
COMMENT ON COLUMN public.skills.subagent_tools IS
  'Whitelist of tool names the sub-agent is allowed to call. Null = all tools. Empty array = no tools (reasoning-only).';
COMMENT ON COLUMN public.skills.subagent_max_turns IS
  'Hard cap on agent-loop iterations for this sub-agent. Null = inherit system default (20).';

-- Index to make the list_skills_plugins query fast
CREATE INDEX IF NOT EXISTS idx_skills_subagent_enabled
  ON public.skills (workspace_id, updated_at DESC)
  WHERE is_subagent = true;

-- ─── 2. subagent_invocations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subagent_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_operator_run_id uuid REFERENCES public.workspace_operator_runs(id) ON DELETE SET NULL,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  task text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  summary text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  tool_calls_count integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  modal_run_id text,
  depth integer NOT NULL DEFAULT 1 CHECK (depth BETWEEN 1 AND 3)
);

CREATE INDEX IF NOT EXISTS idx_subagent_invocations_parent
  ON public.subagent_invocations (parent_operator_run_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_subagent_invocations_workspace
  ON public.subagent_invocations (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_subagent_invocations_active
  ON public.subagent_invocations (status)
  WHERE status IN ('queued', 'running');

ALTER TABLE public.subagent_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY subagent_invocations_member_select ON public.subagent_invocations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = subagent_invocations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Writes go through the service-role admin client (Modal dispatch + route handlers).

COMMENT ON TABLE public.subagent_invocations IS
  'One row per sub-agent call. Orchestrator (Pog) invokes subagents via the invoke_subagent tool; this table is the source of truth for invocation status and final summaries. Transcripts live in workspace_operator_runs per standard Modal pipeline.';
