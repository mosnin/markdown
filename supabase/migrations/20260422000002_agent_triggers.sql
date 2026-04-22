-- Agent trigger configurations.
--
-- Stores the WHEN/WHAT for automated agent runs. Trigger evaluation
-- and dispatch happen in the Python harness (Modal); this table is
-- the authoritative config store that the harness polls.
--
-- Trigger types:
--   note_created   — fires when a note is added to a watched box
--   note_updated   — fires when a note in a watched box is saved
--   schedule       — fires on a cron schedule (cron_expression required)
--   manual         — shown in the UI as a one-click run button (no auto-fire)

CREATE TABLE IF NOT EXISTS public.agent_triggers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  trigger_type    text NOT NULL CHECK (trigger_type IN ('note_created', 'note_updated', 'schedule', 'manual')),
  -- Optional: restrict trigger to a specific box (null = all boxes)
  box_id          uuid REFERENCES public.boxes(id) ON DELETE CASCADE,
  -- For schedule triggers: a cron expression (e.g. '0 9 * * 1' = Mon 9am UTC)
  cron_expression text,
  -- Human-readable label shown in the UI
  label           text NOT NULL DEFAULT '',
  -- Whether this trigger is active
  is_enabled      boolean NOT NULL DEFAULT true,
  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_triggers_agent_id   ON public.agent_triggers (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_workspace  ON public.agent_triggers (workspace_id) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_agent_triggers_box_id     ON public.agent_triggers (box_id) WHERE box_id IS NOT NULL;

-- Auto-update updated_at
CREATE TRIGGER agent_triggers_updated_at
  BEFORE UPDATE ON public.agent_triggers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.agent_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage their triggers"
  ON public.agent_triggers
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_memberships
      WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.agent_triggers IS
  'Defines when an agent should auto-run. Evaluated by the Python harness.';
