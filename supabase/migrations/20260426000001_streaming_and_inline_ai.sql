-- Phase 7 — Streaming + inline AI.
--
-- Two changes:
--   1. Widen operator_run_events.event_type CHECK to include 'text_delta'
--      so the Modal harness can emit token-level streaming events.
--   2. Add inline_command_invocations to track `/summarize`, `/translate`,
--      etc. slash-command invocations from the note editor. Each invocation
--      may delegate to a sub-agent (linked via subagent_invocation_id) or
--      run inline against a built-in prompt.

-- ─── 1. Widen operator_run_events event_type CHECK ──────────────────────
ALTER TABLE public.operator_run_events
  DROP CONSTRAINT IF EXISTS operator_run_events_event_type_check;

ALTER TABLE public.operator_run_events
  ADD CONSTRAINT operator_run_events_event_type_check CHECK (
    event_type IN (
      'run_start',
      'run_end',
      'plan_ready',
      'plan_approved',
      'step_start',
      'step_complete',
      'tool_call_start',
      'tool_call_end',
      'tool_call_error',
      'tool_call_approval_requested',
      'tool_call_approval_granted',
      'tool_call_approval_rejected',
      'tool_call_preview_diff',
      'llm_call_start',
      'llm_call_end',
      'usage_update',
      'note_drafted',
      'steer_message_received',
      'guardrail_tripped',
      'subagent_start',
      'subagent_end',
      'text_delta',
      'completed',
      'failed',
      'cancelled'
    )
  );

COMMENT ON CONSTRAINT operator_run_events_event_type_check ON public.operator_run_events IS
  'Keep in sync with OperatorRunEventType in src/server/services/operator_run_events_service.ts. text_delta added in Phase 7 for SSE streaming.';

-- ─── 2. inline_command_invocations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inline_command_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  command_id text NOT NULL,
  subagent_invocation_id uuid REFERENCES public.subagent_invocations(id) ON DELETE SET NULL,
  selection_start integer,
  selection_end integer,
  status text NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'completed', 'failed', 'cancelled')
  ),
  output text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_inline_command_invocations_note
  ON public.inline_command_invocations (note_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inline_command_invocations_workspace
  ON public.inline_command_invocations (workspace_id, created_at DESC);

ALTER TABLE public.inline_command_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY inline_command_invocations_member_select ON public.inline_command_invocations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = inline_command_invocations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Inserts + updates go through the service-role admin client used by
-- `runInlineCommandAction` and the Modal streaming callback.

COMMENT ON TABLE public.inline_command_invocations IS
  'Slash-command invocations from the note editor. command_id is a built-in id (e.g. "summarize") or "skill:<uuid>" for a workspace-defined sub-agent skill. output is populated when status=completed.';
