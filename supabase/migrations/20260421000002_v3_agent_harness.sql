-- =============================================================================
-- V3 Agent Harness — tables that turn the Workspace Operator into a
-- Claude-Code-class agent surface.
-- Migration: 20260421000002_v3_agent_harness.sql
--
-- Adds seven tables that collectively enable:
--
--   * operator_run_events            — persistent per-tool event stream
--                                      (today events are broadcast-only over
--                                      Supabase Realtime; this gives us a
--                                      durable replay + audit surface and the
--                                      ability to reconnect mid-run without
--                                      losing history)
--   * tool_call_approvals            — human-in-the-loop gate; every write
--                                      tool in "requires_approval" mode
--                                      parks here until a human approves /
--                                      rejects / edits args
--   * run_plans                      — structured plan-first documents, keyed
--                                      by run; supports user-editable steps
--                                      with status + tool sketch
--   * run_messages                   — mid-run steering; user can send a
--                                      "wait, focus on X instead" message
--                                      that the agent picks up at the next
--                                      tool boundary
--   * agent_memories                 — persistent cross-session memory keyed
--                                      by workspace; agent writes + reads
--                                      structured entries across runs
--   * agent_personas                 — named agent configurations (system
--                                      prompt override, tool allowlist, model,
--                                      requires_approval, plan_first);
--                                      pre-seeded with five starters
--   * agent_code_executions          — outputs of the new execute_code tool;
--                                      captures stdout / stderr / return
--                                      value + a link to the owning run
--
-- All seven are RLS-protected and scoped to the workspace the run belongs to,
-- except agent_personas which is partitioned into workspace-level (per-ws
-- overrides) and global (system-provided) rows. We piggyback on the existing
-- public.owns_workspace() / public.can_admin_workspace() helpers to keep the
-- gate consistent with workspace_operator_runs.
-- =============================================================================

-- =============================================================================
-- 1. operator_run_events — durable tool-call + lifecycle event stream
-- =============================================================================

CREATE TABLE public.operator_run_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid        NOT NULL REFERENCES public.workspace_operator_runs(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sequence        bigint      NOT NULL,
  event_type      text        NOT NULL CHECK (event_type IN (
                                'run_start', 'run_end',
                                'plan_ready', 'plan_approved',
                                'step_start', 'step_complete',
                                'tool_call_start', 'tool_call_end',
                                'tool_call_error', 'tool_call_approval_requested',
                                'tool_call_approval_granted', 'tool_call_approval_rejected',
                                'tool_call_preview_diff',
                                'llm_call_start', 'llm_call_end',
                                'usage_update',
                                'note_drafted',
                                'steer_message_received',
                                'guardrail_tripped',
                                'subagent_start', 'subagent_end',
                                'completed', 'failed', 'cancelled'
                              )),
  tool_name       text,
  tool_call_id    text,
  step_index      integer,
  -- Full argument / result payload. Kept as jsonb so the UI can render JSON
  -- tool args + structured diffs without needing a follow-up fetch.
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  elapsed_ms      integer,
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Sequence is unique per-run so the UI can stream events in strict order even
-- if the server fans them out across workers.
CREATE UNIQUE INDEX operator_run_events_run_sequence_idx
  ON public.operator_run_events (run_id, sequence);

CREATE INDEX operator_run_events_run_created_idx
  ON public.operator_run_events (run_id, created_at);

CREATE INDEX operator_run_events_workspace_idx
  ON public.operator_run_events (workspace_id, created_at DESC);

CREATE INDEX operator_run_events_tool_call_idx
  ON public.operator_run_events (tool_call_id)
  WHERE tool_call_id IS NOT NULL;

ALTER TABLE public.operator_run_events ENABLE ROW LEVEL SECURITY;

-- Workspace members can read the full event stream. Only service-role writes
-- (the Python agent proxied through /api/agent/tools/*) can INSERT, so we do
-- not expose INSERT/UPDATE/DELETE policies to `authenticated`.
CREATE POLICY operator_run_events_member_select
  ON public.operator_run_events
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- =============================================================================
-- 2. tool_call_approvals — human-in-the-loop gate
-- =============================================================================

CREATE TABLE public.tool_call_approvals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid        NOT NULL REFERENCES public.workspace_operator_runs(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tool_call_id    text        NOT NULL,
  tool_name       text        NOT NULL,
  -- What the agent wanted to do. JSON args. The user can edit this before
  -- approving — the edited payload lands in `resolved_args`.
  requested_args  jsonb       NOT NULL,
  -- Optional preview (e.g. diff for draft_note/edit_note). Helps the user
  -- approve with full context.
  preview         jsonb,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'timed_out')),
  resolved_args   jsonb,
  resolved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reject_reason   text,
  timeout_at      timestamptz,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE UNIQUE INDEX tool_call_approvals_run_call_idx
  ON public.tool_call_approvals (run_id, tool_call_id);

CREATE INDEX tool_call_approvals_run_status_idx
  ON public.tool_call_approvals (run_id, status);

CREATE INDEX tool_call_approvals_workspace_pending_idx
  ON public.tool_call_approvals (workspace_id, requested_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.tool_call_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tool_call_approvals_member_select
  ON public.tool_call_approvals
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- Approvals are resolved by the workspace member viewing the run — we let
-- any workspace member approve/reject (same trust model as reviewing a draft
-- branch); `resolved_by` records who did it.
CREATE POLICY tool_call_approvals_member_update
  ON public.tool_call_approvals
  FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

-- =============================================================================
-- 3. run_plans — structured plan-first documents
-- =============================================================================

CREATE TABLE public.run_plans (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid        NOT NULL UNIQUE REFERENCES public.workspace_operator_runs(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  summary         text,
  -- Ordered array of step objects:
  --   { index, description, tool, args_sketch, status }
  -- status in ('pending', 'in_progress', 'completed', 'failed', 'skipped')
  steps           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  approved        boolean     NOT NULL DEFAULT false,
  approved_at     timestamptz,
  approved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX run_plans_workspace_idx
  ON public.run_plans (workspace_id, created_at DESC);

CREATE TRIGGER run_plans_set_updated_at
  BEFORE UPDATE ON public.run_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.run_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY run_plans_member_select
  ON public.run_plans
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY run_plans_member_update
  ON public.run_plans
  FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

-- =============================================================================
-- 4. run_messages — mid-run steering inbox
-- =============================================================================

CREATE TABLE public.run_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid        NOT NULL REFERENCES public.workspace_operator_runs(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sender_user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content         text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Agent polls for unread messages ordered by creation.
CREATE INDEX run_messages_run_unread_idx
  ON public.run_messages (run_id, created_at)
  WHERE consumed_at IS NULL;

CREATE INDEX run_messages_workspace_idx
  ON public.run_messages (workspace_id, created_at DESC);

ALTER TABLE public.run_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY run_messages_member_select
  ON public.run_messages
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY run_messages_member_insert
  ON public.run_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND public.owns_workspace(workspace_id)
  );

-- =============================================================================
-- 5. agent_memories — persistent cross-session memory
-- =============================================================================

CREATE TABLE public.agent_memories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  memory_type     text        NOT NULL CHECK (memory_type IN (
                                'workspace_facts',
                                'user_preferences',
                                'recent_work',
                                'learned_schemas',
                                'project_context'
                              )),
  title           text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content         text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  -- Higher score = more likely to be pulled into run prologue. The agent can
  -- boost / decay as it references entries across runs.
  relevance       real        NOT NULL DEFAULT 1.0
                    CHECK (relevance >= 0 AND relevance <= 10),
  created_by_run  uuid        REFERENCES public.workspace_operator_runs(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);

CREATE INDEX agent_memories_workspace_type_idx
  ON public.agent_memories (workspace_id, memory_type, relevance DESC);

CREATE INDEX agent_memories_workspace_recent_idx
  ON public.agent_memories (workspace_id, last_used_at DESC NULLS LAST);

CREATE TRIGGER agent_memories_set_updated_at
  BEFORE UPDATE ON public.agent_memories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_memories_member_select
  ON public.agent_memories
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY agent_memories_admin_insert
  ON public.agent_memories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY agent_memories_admin_update
  ON public.agent_memories
  FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY agent_memories_admin_delete
  ON public.agent_memories
  FOR DELETE
  TO authenticated
  USING (public.can_admin_workspace(workspace_id));

-- =============================================================================
-- 6. agent_personas — named agent configurations
-- =============================================================================

CREATE TABLE public.agent_personas (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL workspace_id = global / system-provided persona.
  workspace_id        uuid        REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug                text        NOT NULL CHECK (slug ~ '^[a-z0-9_-]{2,40}$'),
  name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description         text,
  system_prompt       text,
  tool_allowlist      text[]      NOT NULL DEFAULT '{}',
  model               text,
  max_turns           integer     CHECK (max_turns IS NULL OR (max_turns BETWEEN 1 AND 200)),
  requires_approval   boolean     NOT NULL DEFAULT false,
  plan_first          boolean     NOT NULL DEFAULT false,
  must_cite_per_claim boolean     NOT NULL DEFAULT false,
  is_system           boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One persona per slug per scope (workspace or global).
CREATE UNIQUE INDEX agent_personas_scope_slug_idx
  ON public.agent_personas (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

CREATE INDEX agent_personas_workspace_idx
  ON public.agent_personas (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE TRIGGER agent_personas_set_updated_at
  BEFORE UPDATE ON public.agent_personas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_personas_read
  ON public.agent_personas
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IS NULL
    OR public.owns_workspace(workspace_id)
  );

CREATE POLICY agent_personas_admin_insert
  ON public.agent_personas
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id IS NOT NULL
    AND is_system = false
    AND public.can_admin_workspace(workspace_id)
  );

CREATE POLICY agent_personas_admin_update
  ON public.agent_personas
  FOR UPDATE
  TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND is_system = false
    AND public.can_admin_workspace(workspace_id)
  )
  WITH CHECK (
    workspace_id IS NOT NULL
    AND is_system = false
    AND public.can_admin_workspace(workspace_id)
  );

CREATE POLICY agent_personas_admin_delete
  ON public.agent_personas
  FOR DELETE
  TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND is_system = false
    AND public.can_admin_workspace(workspace_id)
  );

-- Seed five system personas. These are the defaults every workspace sees on
-- run start. Workspace admins can override any slug by creating a per-ws row.
INSERT INTO public.agent_personas
  (workspace_id, slug, name, description, system_prompt, tool_allowlist,
   model, max_turns, requires_approval, plan_first, must_cite_per_claim, is_system)
VALUES
  (
    NULL, 'research_assistant', 'Research Assistant',
    'Reads widely, searches the web, and drafts well-cited research summaries.',
    'You are a research assistant for a Context Store workspace. You read existing notes, search the web for primary sources, and draft clear, well-cited research summaries. Cite every factual claim with a [[note_id]] reference or a web URL. Never fabricate.',
    ARRAY['hybrid_search','read_note','list_notes_in_box','web_search','web_fetch','draft_note','link_notes','run_memory']::text[],
    'gpt-4.1', 60, false, false, true, true
  ),
  (
    NULL, 'box_organizer', 'Box Organizer',
    'Analyzes workspace structure and proposes box / folder reorganizations for review.',
    'You are a workspace structure specialist. You analyze the notes in a workspace and propose a better box / folder structure. Never execute structural changes directly — produce a reorganization proposal the user can review.',
    ARRAY['hybrid_search','read_note','list_notes_in_box','propose_box_structure','run_memory']::text[],
    'o4-mini', 40, true, true, false, false
  ),
  (
    NULL, 'code_reviewer', 'Code Reviewer',
    'Reads code notes, runs test snippets in the sandbox, drafts review notes.',
    'You are a code reviewer. You read code-bearing notes, optionally run small snippets in the sandbox to verify behavior, and draft a review note. Do not edit the reviewed notes — draft a separate review.',
    ARRAY['hybrid_search','read_note','list_notes_in_box','web_search','web_fetch','execute_code','draft_note','link_notes','run_memory']::text[],
    'gpt-4.1', 60, true, false, false, false
  ),
  (
    NULL, 'daily_standup', 'Daily Standup',
    'Reads yesterday''s notes and drafts a daily standup summary.',
    'You are a daily standup assistant. Read the most recent notes in the workspace (last 24-72 hours), identify progress, blockers, and next-steps, and draft a single standup note.',
    ARRAY['hybrid_search','read_note','list_notes_in_box','draft_note','link_notes','run_memory']::text[],
    'gpt-4.1-mini', 20, false, false, false, false
  ),
  (
    NULL, 'deep_writer', 'Deep Writer',
    'Plan-first, approval-gated long-form writing with heavy research.',
    'You are a long-form writer. Plan every document before drafting. You must produce a plan, wait for human approval, and then execute. Cite every factual claim. All writes require human approval before execution.',
    ARRAY['hybrid_search','read_note','list_notes_in_box','web_search','web_fetch','draft_note','edit_note','link_notes','run_memory']::text[],
    'gpt-4.1', 80, true, true, true, true
  );

-- =============================================================================
-- 7. agent_code_executions — outputs of the execute_code sandbox tool
-- =============================================================================

CREATE TABLE public.agent_code_executions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid        NOT NULL REFERENCES public.workspace_operator_runs(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tool_call_id    text,
  language        text        NOT NULL CHECK (language IN ('python', 'javascript')),
  code            text        NOT NULL CHECK (char_length(code) BETWEEN 1 AND 20000),
  stdout          text,
  stderr          text,
  return_value    text,
  exit_code       integer,
  elapsed_ms      integer,
  -- Was this execution truncated? Size limit on captured streams is enforced
  -- at the runner, but we record the flag so the UI can warn.
  truncated       boolean     NOT NULL DEFAULT false,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_code_executions_run_idx
  ON public.agent_code_executions (run_id, created_at);

CREATE INDEX agent_code_executions_workspace_idx
  ON public.agent_code_executions (workspace_id, created_at DESC);

ALTER TABLE public.agent_code_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_code_executions_member_select
  ON public.agent_code_executions
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- =============================================================================
-- 8. Extensions to workspace_operator_runs — persona + plan_first flag
-- =============================================================================

ALTER TABLE public.workspace_operator_runs
  ADD COLUMN IF NOT EXISTS persona_slug      text,
  ADD COLUMN IF NOT EXISTS plan_first        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_at         timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason     text;

-- Partial index to quickly find runs currently awaiting an approval.
CREATE INDEX IF NOT EXISTS workspace_operator_runs_paused_idx
  ON public.workspace_operator_runs (id)
  WHERE paused_at IS NOT NULL;
