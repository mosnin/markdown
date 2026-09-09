-- =============================================================================
-- Agent Context Relay — core schema
-- Migration: 20260909000001_agent_context_relay.sql
--
-- This migration introduces the product's new core: a real-time, append-only
-- log of what coding agents are doing, and the handoff briefs that let the
-- NEXT agent pick up where the last one stopped.
--
-- The problem being solved: you run several agent sessions against one repo
-- (Claude Code on one plan, Codex on another, a teammate's Cursor). One hits a
-- usage cap mid-task. The next agent starts with zero knowledge of what was
-- tried, what failed, what was decided, and what is half-finished. Everything
-- here exists to make that handoff lossless.
--
-- Tables:
--   projects            — the thing being worked on (usually a repo)
--   agent_sessions      — one run of one agent against one project
--   session_events      — append-only event log, monotonic per session
--   session_checkpoints — distilled rollups of a session's state
--   handoff_briefs      — the assembled brief served to a resuming agent
--
-- Functions:
--   append_session_events() — atomic, idempotent, sequence-allocating insert
--
-- Sequencing / idempotency note:
--   Hooks fire from processes that crash, get SIGKILLed at a usage cap, and
--   retry from an on-disk spool. Ingest is therefore idempotent on
--   (session_id, client_event_id) and sequence allocation happens server-side
--   under a row lock, so a replayed batch can never fork the ordering.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. projects
--
--    A project is the unit agents relay context around — nearly always a
--    repository, but a project can be anything with a stable slug inside a
--    workspace. Sessions and events are always project-scoped so a brief can
--    be assembled without scanning the whole workspace.
--
--    repo_url is advisory: the hook installer fills it from `git remote`
--    so the UI can group sessions from different machines on one project.
-- ---------------------------------------------------------------------------

CREATE TABLE public.projects (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name           text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug           text        NOT NULL
                             CHECK (slug ~ '^[a-z0-9][a-z0-9._-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  description    text,
  repo_url       text,
  default_branch text,
  status         text        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'archived')),
  -- Rolling denormalised counters so the project list does not need to
  -- aggregate the event log on every page load.
  session_count  integer     NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  last_active_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, slug)
);

CREATE INDEX projects_workspace_active_idx
  ON public.projects (workspace_id, last_active_at DESC NULLS LAST);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. agent_sessions
--
--    One run of one agent. The columns that matter for the relay:
--
--    external_id      Client-generated and stable for the life of the agent
--                     process (Claude Code session id, Codex thread id, or a
--                     uuid the CLI mints). Ingest is idempotent on it, so a
--                     hook that fires twice does not open two sessions.
--
--    account_label    Which plan/account/seat this session burned. This is
--                     what makes "plan A capped, continue on plan B" legible
--                     rather than a mystery gap in the timeline.
--
--    end_reason       'usage_capped' is a first-class outcome, not an error.
--                     A capped session is the single strongest signal that a
--                     handoff brief is about to be needed.
--
--    resumed_from_session_id
--                     The relay edge. Set when a session opens with a brief
--                     assembled from an earlier session, which turns the
--                     sessions table into a chain the UI can walk backwards.
-- ---------------------------------------------------------------------------

CREATE TABLE public.agent_sessions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id              uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  external_id             text        NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 200),

  agent_tool              text        NOT NULL DEFAULT 'custom'
                                      CHECK (agent_tool IN (
                                        'claude_code', 'codex', 'cursor',
                                        'copilot', 'aider', 'ci', 'custom'
                                      )),
  agent_model             text,
  account_label           text,
  agent_version           text,

  host                    text,
  cwd                     text,
  git_branch              text,
  git_commit              text,

  title                   text,
  goal                    text,

  status                  text        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'idle', 'ended')),
  end_reason              text        CHECK (end_reason IS NULL OR end_reason IN (
                                        'completed', 'usage_capped', 'context_exhausted',
                                        'crashed', 'user_stopped', 'unknown'
                                      )),

  resumed_from_session_id uuid        REFERENCES public.agent_sessions(id) ON DELETE SET NULL,

  -- Sequence high-water mark. Also the allocator for append_session_events().
  event_count             bigint      NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  tokens_in               bigint      NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out              bigint      NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd                numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),

  metadata                jsonb,
  started_at              timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  ended_at                timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Idempotency key for session open. Scoped to the project so two repos can
  -- both carry a session called "1" from a naive client.
  UNIQUE (project_id, external_id),

  -- A session is ended if and only if it carries an end timestamp.
  CONSTRAINT agent_sessions_ended_consistent
    CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);

CREATE INDEX agent_sessions_project_started_idx
  ON public.agent_sessions (project_id, started_at DESC);
CREATE INDEX agent_sessions_workspace_started_idx
  ON public.agent_sessions (workspace_id, started_at DESC);
-- Partial index for the hot "who is working right now" query.
CREATE INDEX agent_sessions_live_idx
  ON public.agent_sessions (project_id, last_seen_at DESC)
  WHERE status <> 'ended';
CREATE INDEX agent_sessions_resumed_from_idx
  ON public.agent_sessions (resumed_from_session_id)
  WHERE resumed_from_session_id IS NOT NULL;

CREATE TRIGGER agent_sessions_set_updated_at
  BEFORE UPDATE ON public.agent_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. session_events
--
--    The append-only log. Rows are never updated by application code — the
--    only mutation path is redaction (see redacted_at), which blanks the
--    payload in place and is deliberately rare.
--
--    summary is required and short: it is the line the next agent actually
--    reads. payload is the full structured detail and may be large, so the
--    brief assembler reads summaries first and only pulls payloads when the
--    token budget allows.
--
--    Volume note: this table grows fast (a busy Claude Code session emits
--    hundreds of events an hour). It is intentionally NOT partitioned yet —
--    the indexes below carry it comfortably to millions of rows, and the
--    existing partition-maintenance job in internal/partition_maintenance is
--    the model to follow when it needs partitioning by created_at.
-- ---------------------------------------------------------------------------

CREATE TABLE public.session_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id      uuid        NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,

  -- Monotonic within a session, allocated by append_session_events().
  sequence        bigint      NOT NULL CHECK (sequence > 0),

  event_type      text        NOT NULL CHECK (event_type IN (
                                'session_start', 'session_end',
                                'prompt', 'assistant_message',
                                'tool_call', 'tool_result', 'tool_error',
                                'file_read', 'file_edit', 'file_create', 'file_delete',
                                'command', 'command_result',
                                'test_run', 'build', 'lint',
                                'commit', 'branch_change', 'push',
                                'decision', 'blocker', 'question',
                                'note', 'checkpoint', 'compaction',
                                'usage_update', 'usage_limit',
                                'handoff_requested', 'handoff_consumed',
                                'error', 'custom'
                              )),

  -- Short human/agent readable line. This is what lands in a brief.
  summary         text        NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  -- Full structured detail: tool args, diffs, stdout, etc.
  payload         jsonb,

  actor           text        NOT NULL DEFAULT 'agent'
                              CHECK (actor IN ('agent', 'user', 'system', 'hook')),
  tool_name       text,
  -- Files this event touched. Powers "what has been changed so far" without
  -- unpacking every payload.
  files           text[]      NOT NULL DEFAULT '{}',

  -- Salience: 0 = noise, 5 = must appear in every brief. The assembler sorts
  -- on this before it sorts on recency, so a decision made an hour ago
  -- outranks a file read from a minute ago.
  importance      smallint    NOT NULL DEFAULT 2
                              CHECK (importance BETWEEN 0 AND 5),

  tokens_in       integer     NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out      integer     NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd        numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),

  -- Client-side idempotency key. Hooks retry from an on-disk spool after a
  -- crash, so the same event can legitimately arrive twice.
  client_event_id text        CHECK (client_event_id IS NULL OR char_length(client_event_id) <= 200),

  -- Set when a payload has been scrubbed after the fact.
  redacted_at     timestamptz,

  -- When the event happened on the client, which is not when we received it.
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (session_id, sequence)
);

-- Idempotency: only enforced for rows that carry a key.
CREATE UNIQUE INDEX session_events_client_event_id_idx
  ON public.session_events (session_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- Brief assembly and timeline paging.
CREATE INDEX session_events_session_seq_idx
  ON public.session_events (session_id, sequence DESC);
CREATE INDEX session_events_project_occurred_idx
  ON public.session_events (project_id, occurred_at DESC);
-- The assembler's hot path: high-salience events for a project, newest first.
CREATE INDEX session_events_project_importance_idx
  ON public.session_events (project_id, importance DESC, occurred_at DESC)
  WHERE importance >= 3;
-- File-centric lookups ("what happened to src/auth.ts").
CREATE INDEX session_events_files_idx
  ON public.session_events USING gin (files);

-- ---------------------------------------------------------------------------
-- 4. session_checkpoints
--
--    A checkpoint is the distilled state of a session over a sequence range:
--    what the goal is, what is done, what is in flight, what is blocked, what
--    was decided, what to do next. Checkpoints are what make briefs cheap —
--    the assembler prefers one checkpoint over the 200 events it summarises.
--
--    kind = 'compaction' records a checkpoint written because the agent's own
--    context was about to be compacted, which is the moment most context is
--    historically lost.
-- ---------------------------------------------------------------------------

CREATE TABLE public.session_checkpoints (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id     uuid        NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,

  kind           text        NOT NULL DEFAULT 'auto'
                             CHECK (kind IN ('auto', 'manual', 'compaction', 'session_end')),

  seq_from       bigint      NOT NULL CHECK (seq_from >= 0),
  seq_to         bigint      NOT NULL CHECK (seq_to >= 0),

  summary        text        NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 20000),
  -- Structured state. Shape (all optional arrays of strings unless noted):
  --   { goal, done[], in_flight[], blocked[], decisions[], next_steps[],
  --     files_touched[], open_questions[] }
  state          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  token_estimate integer     NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT session_checkpoints_seq_range CHECK (seq_to >= seq_from)
);

CREATE INDEX session_checkpoints_session_idx
  ON public.session_checkpoints (session_id, seq_to DESC);
CREATE INDEX session_checkpoints_project_idx
  ON public.session_checkpoints (project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. handoff_briefs
--
--    A materialised brief. Persisted rather than computed-and-forgotten for
--    three reasons: the resuming agent can be shown exactly what it was told,
--    briefs are the audit trail of what context crossed between accounts, and
--    a brief that was already assembled can be re-served on reconnect without
--    re-reading the log.
-- ---------------------------------------------------------------------------

CREATE TABLE public.handoff_briefs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id               uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- The session that asked for the brief. Null when a human generated it
  -- from the dashboard before starting an agent.
  requested_by_session_id  uuid        REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  -- The sessions whose context was folded in, newest first.
  source_session_ids       uuid[]      NOT NULL DEFAULT '{}',

  budget_tokens            integer     NOT NULL CHECK (budget_tokens > 0),
  token_estimate           integer     NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),

  -- The rendered markdown handed to the agent.
  body                     text        NOT NULL,
  -- The same content structured, for clients that would rather have JSON.
  state                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX handoff_briefs_project_idx
  ON public.handoff_briefs (project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. append_session_events()
--
--    Atomic batch append. Does four things under one row lock so concurrent
--    hooks from the same session cannot interleave badly:
--
--      1. Locks the session row (FOR UPDATE) — serialises sequence allocation.
--      2. Skips events whose client_event_id was already accepted.
--      3. Assigns sequences from event_count + 1 upward.
--      4. Advances event_count / last_seen_at / usage counters.
--
--    Returns the rows it actually inserted (a replayed batch returns zero
--    rows), so the caller can fan those out to webhooks and Realtime without
--    re-broadcasting duplicates.
--
--    p_events is a jsonb array of objects. Recognised keys mirror the
--    session_events columns; unknown keys are ignored.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.append_session_events(
  p_session_id uuid,
  p_events     jsonb
)
RETURNS SETOF public.session_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session      public.agent_sessions%ROWTYPE;
  v_next_seq     bigint;
  v_event        jsonb;
  v_client_id    text;
  v_inserted     public.session_events%ROWTYPE;
  v_tokens_in    bigint := 0;
  v_tokens_out   bigint := 0;
  v_cost         numeric(12, 6) := 0;
  v_max_occurred timestamptz;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'p_events must be a jsonb array';
  END IF;

  SELECT * INTO v_session
  FROM public.agent_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session % not found', p_session_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_next_seq := v_session.event_count;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
  LOOP
    v_client_id := NULLIF(v_event ->> 'client_event_id', '');

    -- Already accepted on an earlier attempt — skip without consuming a
    -- sequence number, so the log stays gap-free.
    IF v_client_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.session_events
      WHERE session_id = p_session_id AND client_event_id = v_client_id
    ) THEN
      CONTINUE;
    END IF;

    v_next_seq := v_next_seq + 1;

    INSERT INTO public.session_events (
      workspace_id, project_id, session_id, sequence,
      event_type, summary, payload, actor, tool_name, files,
      importance, tokens_in, tokens_out, cost_usd,
      client_event_id, occurred_at
    )
    VALUES (
      v_session.workspace_id,
      v_session.project_id,
      p_session_id,
      v_next_seq,
      COALESCE(v_event ->> 'event_type', 'custom'),
      COALESCE(NULLIF(v_event ->> 'summary', ''), '(no summary)'),
      v_event -> 'payload',
      COALESCE(v_event ->> 'actor', 'agent'),
      NULLIF(v_event ->> 'tool_name', ''),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_event -> 'files') = 'array'
               THEN v_event -> 'files' ELSE '[]'::jsonb END
        )),
        '{}'::text[]
      ),
      COALESCE((v_event ->> 'importance')::smallint, 2),
      COALESCE((v_event ->> 'tokens_in')::integer, 0),
      COALESCE((v_event ->> 'tokens_out')::integer, 0),
      COALESCE((v_event ->> 'cost_usd')::numeric, 0),
      v_client_id,
      COALESCE((v_event ->> 'occurred_at')::timestamptz, now())
    )
    RETURNING * INTO v_inserted;

    v_tokens_in  := v_tokens_in + v_inserted.tokens_in;
    v_tokens_out := v_tokens_out + v_inserted.tokens_out;
    v_cost       := v_cost + v_inserted.cost_usd;
    v_max_occurred := GREATEST(COALESCE(v_max_occurred, v_inserted.occurred_at),
                               v_inserted.occurred_at);

    RETURN NEXT v_inserted;
  END LOOP;

  -- Advance the session even when every event was a duplicate: the fact that
  -- the client is still talking to us is itself liveness.
  UPDATE public.agent_sessions
  SET event_count  = v_next_seq,
      tokens_in    = tokens_in + v_tokens_in,
      tokens_out   = tokens_out + v_tokens_out,
      cost_usd     = cost_usd + v_cost,
      last_seen_at = GREATEST(last_seen_at, COALESCE(v_max_occurred, now())),
      -- A session that was marked idle is active again the moment it speaks.
      status       = CASE WHEN status = 'idle' THEN 'active' ELSE status END
  WHERE id = p_session_id;

  UPDATE public.projects
  SET last_active_at = now()
  WHERE id = v_session.project_id;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.append_session_events(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_session_events(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS
--
--    Reads: any workspace member, via public.owns_workspace() — the same gate
--    every other workspace-scoped table uses.
--
--    Writes: none for `authenticated` on the event log. Events arrive from
--    machine tokens through the service role (which bypasses RLS), and the
--    log is append-only by design: no UI path may rewrite history. Projects
--    are the exception — humans create and rename those.
-- ---------------------------------------------------------------------------

ALTER TABLE public.projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoff_briefs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_member_select
  ON public.projects FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY projects_member_insert
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY projects_admin_update
  ON public.projects FOR UPDATE TO authenticated
  USING (public.can_admin_workspace(workspace_id))
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY projects_admin_delete
  ON public.projects FOR DELETE TO authenticated
  USING (public.can_admin_workspace(workspace_id));

CREATE POLICY agent_sessions_member_select
  ON public.agent_sessions FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

-- Humans may retire a stuck session from the dashboard; they may not forge one.
CREATE POLICY agent_sessions_admin_update
  ON public.agent_sessions FOR UPDATE TO authenticated
  USING (public.can_admin_workspace(workspace_id))
  WITH CHECK (public.can_admin_workspace(workspace_id));

CREATE POLICY session_events_member_select
  ON public.session_events FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY session_checkpoints_member_select
  ON public.session_checkpoints FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY session_checkpoints_member_insert
  ON public.session_checkpoints FOR INSERT TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY handoff_briefs_member_select
  ON public.handoff_briefs FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY handoff_briefs_member_insert
  ON public.handoff_briefs FOR INSERT TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 8. Machine identity for hooks
--
--    Hook shims run on developer laptops and CI runners. They cannot complete
--    an OAuth browser dance, so they authenticate with a long-lived scoped
--    connection token (the csk_v1_ family in
--    src/server/auth/get_connection_context.ts). We widen connection_type to
--    name that use explicitly rather than overloading 'api', so the
--    connections UI can show "agent hook" credentials as their own class.
-- ---------------------------------------------------------------------------

ALTER TABLE public.connections
  DROP CONSTRAINT IF EXISTS connections_connection_type_check;

ALTER TABLE public.connections
  ADD CONSTRAINT connections_connection_type_check
  CHECK (connection_type IN ('mcp', 'api', 'webhook', 'agent_hook'));
