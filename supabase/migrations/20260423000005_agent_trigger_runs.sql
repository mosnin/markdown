-- agent_trigger_runs — one row per trigger fire.
--
-- Source of truth for "how often did this trigger run and was it healthy?"
-- Populated by the Inngest functions (Phase 2C). Read by the trigger panel
-- UI (Phase 2D) to display success rate, last run, and run history.

CREATE TABLE IF NOT EXISTS public.agent_trigger_runs (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  trigger_id                  uuid NOT NULL REFERENCES public.agent_triggers(id) ON DELETE CASCADE,
  agent_id                    uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  status                      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','skipped')),
  started_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  error                       text,
  skip_reason                 text,
  workspace_operator_run_id   uuid REFERENCES public.workspace_operator_runs(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trigger_runs_trigger  ON public.agent_trigger_runs (trigger_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_runs_workspace ON public.agent_trigger_runs (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_runs_running  ON public.agent_trigger_runs (trigger_id, started_at) WHERE status = 'running';

ALTER TABLE public.agent_trigger_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members read trigger runs"
  ON public.agent_trigger_runs FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

CREATE POLICY "workspace members manage trigger runs"
  ON public.agent_trigger_runs FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));

COMMENT ON TABLE public.agent_trigger_runs IS
  'One row per agent trigger fire. Populated by Inngest execution functions; read by the AgentTriggersPanel UI.';
