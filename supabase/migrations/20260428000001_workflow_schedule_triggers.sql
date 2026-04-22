-- Phase 11C — let agent_triggers also fire workflows.
--
-- A trigger now dispatches to exactly one of:
--   - an agent (agent_id set), OR
--   - a workflow (workflow_id set).
-- Enforced by a CHECK constraint.

ALTER TABLE public.agent_triggers
  ADD COLUMN IF NOT EXISTS workflow_id uuid
    REFERENCES public.workflows(id) ON DELETE CASCADE;

ALTER TABLE public.agent_triggers
  ALTER COLUMN agent_id DROP NOT NULL;

ALTER TABLE public.agent_triggers
  ADD CONSTRAINT agent_triggers_exactly_one_target
  CHECK (
    (agent_id IS NOT NULL AND workflow_id IS NULL)
    OR (agent_id IS NULL AND workflow_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_agent_triggers_workflow_id
  ON public.agent_triggers (workflow_id)
  WHERE workflow_id IS NOT NULL;
