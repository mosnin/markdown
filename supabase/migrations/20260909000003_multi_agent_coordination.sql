-- =============================================================================
-- Multi-agent coordination — the shared workspace layer
-- Migration: 20260909000003_multi_agent_coordination.sql
--
-- The first two migrations built a RELAY: agent A stops, agent B picks up. This
-- one builds a WORKSPACE: agents A, B and C working at the same time, on the
-- same repo, aware of each other.
--
-- Different problem, different primitives. Relay is about reading the past.
-- Collaboration is about knowing the present and not colliding.
--
-- The central primitive is the CHECK-IN, and the reason is worth stating
-- because it shapes everything here: a coding agent is turn-based. It cannot
-- hold an SSE connection open between tool calls the way a dashboard can. Push
-- is for humans; agents need pull. So one call does four jobs at once —
-- heartbeat, delta fetch, claim renewal, and conflict report — and the tables
-- below exist to make that one call answer well.
--
-- Tables:
--   project_claims   advisory "I am working on this" markers, with TTL
--   project_notices  agent-to-agent messages on a project
--
-- Plus check-in bookkeeping columns on agent_sessions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Check-in bookkeeping on agent_sessions
--
--    `last_checkin_at` is the delta cursor. Storing it server-side rather than
--    making the agent track one means an agent can call check_in() with no
--    arguments and still get exactly what it has not seen — which matters,
--    because an agent that has to manage a cursor will eventually get it wrong
--    and either miss events or re-read them forever.
--
--    `current_intent` is the one-line answer to "what is this agent doing right
--    now", shown to every other agent. Distinct from `goal`, which is the whole
--    session's purpose: intent changes several times inside one goal.
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_sessions
  ADD COLUMN IF NOT EXISTS last_checkin_at  timestamptz,
  ADD COLUMN IF NOT EXISTS current_intent   text,
  ADD COLUMN IF NOT EXISTS checkin_count    integer NOT NULL DEFAULT 0
                                            CHECK (checkin_count >= 0);

-- ---------------------------------------------------------------------------
-- 2. project_claims
--
--    An advisory marker: "I am working on src/charges/create.ts". Deliberately
--    NOT a lock, and named accordingly. We cannot intercept another agent's
--    edit tool, so we cannot prevent anything — we can only make sure an agent
--    is TOLD before it starts, and told again when someone walks into its
--    territory. Pretending otherwise would be a lie encoded in a name.
--
--    EXPIRY IS NOT OPTIONAL. An agent killed by a usage cap never releases
--    anything: no SessionEnd hook fires, the process is simply gone. A claim
--    without a TTL would leave a dead agent holding a file forever, which is
--    precisely the deadlock this product exists to prevent. Claims are renewed
--    by check-in and expire on their own if the agent stops checking in.
--
--    `resource` is free text so it can name a file path, a directory, a
--    subsystem, or a task. Collision detection is exact-match plus directory
--    prefix; anything cleverer would produce false conflicts, and a false
--    conflict trains agents to ignore conflicts.
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_claims (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id    uuid        NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,

  resource      text        NOT NULL CHECK (char_length(resource) BETWEEN 1 AND 500),
  kind          text        NOT NULL DEFAULT 'file'
                            CHECK (kind IN ('file', 'directory', 'subsystem', 'task')),
  -- Why this agent wants it. Shown to whoever collides with the claim, so they
  -- can decide whether to wait, coordinate, or work elsewhere.
  intent        text        CHECK (intent IS NULL OR char_length(intent) <= 2000),

  claimed_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  released_at   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_claims_expiry_after_claim CHECK (expires_at > claimed_at)
);

-- One live claim per resource per project. Partial so released and expired
-- claims stay as history without blocking the next agent.
CREATE UNIQUE INDEX project_claims_live_resource_idx
  ON public.project_claims (project_id, resource)
  WHERE released_at IS NULL;

CREATE INDEX project_claims_session_idx
  ON public.project_claims (session_id)
  WHERE released_at IS NULL;
CREATE INDEX project_claims_project_live_idx
  ON public.project_claims (project_id, expires_at DESC)
  WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. project_notices
--
--    Agent-to-agent messages. "I changed the charge schema, re-read it before
--    you touch the retry path."
--
--    This is the channel that does not exist anywhere else: the event log is a
--    record of what happened, and a brief is a summary of the past. Neither
--    lets a running agent say something to its peers RIGHT NOW. Without it,
--    coordination degrades to two agents inferring each other's intent from
--    file-edit events, which is guesswork.
--
--    `to_session_id` null means broadcast. Notices expire so a project that has
--    been worked on for months does not hand every new agent a year of chatter.
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_notices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Null when a human posted from the dashboard rather than an agent.
  from_session_id uuid       REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  -- Null means everyone on the project.
  to_session_id  uuid        REFERENCES public.agent_sessions(id) ON DELETE CASCADE,

  kind           text        NOT NULL DEFAULT 'broadcast'
                             CHECK (kind IN ('broadcast', 'direct', 'alert', 'question', 'answer')),
  body           text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- Same 0–5 salience scale as everything else. An 'alert' is what interrupts.
  importance     smallint    NOT NULL DEFAULT 3
                             CHECK (importance BETWEEN 0 AND 5),

  -- Set when a notice needs an answer, so a check-in can surface unanswered
  -- questions rather than letting them scroll away.
  answered_at    timestamptz,
  expires_at     timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_notices_project_created_idx
  ON public.project_notices (project_id, created_at DESC);
CREATE INDEX project_notices_recipient_idx
  ON public.project_notices (to_session_id, created_at DESC)
  WHERE to_session_id IS NOT NULL;
CREATE INDEX project_notices_open_questions_idx
  ON public.project_notices (project_id, created_at DESC)
  WHERE kind = 'question' AND answered_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. claim_resources()
--
--    Claim several resources atomically, reporting conflicts rather than
--    failing. An agent asking for five files and being told "you got four, the
--    fifth is held by session X who is refactoring it" can act sensibly. An
--    agent that gets an error for the whole batch cannot.
--
--    Expired claims are reaped inline: the first agent to ask for a resource is
--    the one who should get it, and making that depend on a cron would mean a
--    dead agent's claim outlives it by however long the cron interval is.
--
--    Re-claiming a resource you already hold extends it. That is what makes
--    check-in-based renewal work without a separate code path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_resources(
  p_session_id  uuid,
  p_resources   jsonb,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS TABLE(
  resource     text,
  granted      boolean,
  held_by      uuid,
  held_intent  text,
  expires_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   public.agent_sessions%ROWTYPE;
  v_item      jsonb;
  v_resource  text;
  v_kind      text;
  v_intent    text;
  v_expires   timestamptz;
  v_existing  public.project_claims%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_resources) <> 'array' THEN
    RAISE EXCEPTION 'p_resources must be a jsonb array';
  END IF;

  SELECT * INTO v_session
  FROM public.agent_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session % not found', p_session_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Reap anything whose holder stopped checking in. Doing this here rather than
  -- on a timer means a dead agent's claim is released the instant somebody
  -- actually wants the resource.
  UPDATE public.project_claims
  SET released_at = now()
  WHERE project_id = v_session.project_id
    AND released_at IS NULL
    AND expires_at < now();

  v_expires := now() + make_interval(secs => GREATEST(60, LEAST(3600, p_ttl_seconds)));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_resources)
  LOOP
    v_resource := NULLIF(trim(v_item ->> 'resource'), '');
    CONTINUE WHEN v_resource IS NULL;

    v_kind := COALESCE(v_item ->> 'kind', 'file');
    v_intent := NULLIF(v_item ->> 'intent', '');

    SELECT * INTO v_existing
    FROM public.project_claims
    WHERE project_id = v_session.project_id
      AND resource = v_resource
      AND released_at IS NULL
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.session_id = p_session_id THEN
        -- Ours already: extend it. This is the check-in renewal path.
        UPDATE public.project_claims
        SET expires_at = v_expires,
            intent = COALESCE(v_intent, intent)
        WHERE id = v_existing.id;

        resource := v_resource;
        granted := true;
        held_by := p_session_id;
        held_intent := COALESCE(v_intent, v_existing.intent);
        expires_at := v_expires;
        RETURN NEXT;
      ELSE
        -- Somebody else holds it. Report who and why rather than erroring, so
        -- the caller can decide: wait, coordinate, or work elsewhere.
        resource := v_resource;
        granted := false;
        held_by := v_existing.session_id;
        held_intent := v_existing.intent;
        expires_at := v_existing.expires_at;
        RETURN NEXT;
      END IF;
    ELSE
      INSERT INTO public.project_claims (
        workspace_id, project_id, session_id, resource, kind, intent, expires_at
      )
      VALUES (
        v_session.workspace_id, v_session.project_id, p_session_id,
        v_resource, v_kind, v_intent, v_expires
      );

      resource := v_resource;
      granted := true;
      held_by := p_session_id;
      held_intent := v_intent;
      expires_at := v_expires;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_resources(uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_resources(uuid, jsonb, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. release_claims()
--
--    Release by resource, or all of a session's claims at once. Called on
--    explicit release and when a session ends cleanly; the TTL covers the case
--    where it does not end cleanly, which is the common one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_claims(
  p_session_id uuid,
  p_resources  jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_resources IS NULL OR jsonb_typeof(p_resources) <> 'array' THEN
    UPDATE public.project_claims
    SET released_at = now()
    WHERE session_id = p_session_id AND released_at IS NULL;
  ELSE
    UPDATE public.project_claims
    SET released_at = now()
    WHERE session_id = p_session_id
      AND released_at IS NULL
      AND resource IN (SELECT jsonb_array_elements_text(p_resources));
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_claims(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_claims(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS
--
--    Reads for workspace members; writes through the service role only, as
--    with every other relay table. Humans can post notices from the dashboard,
--    so notices carry an insert policy — that is the one place a person needs
--    to speak into an agent conversation.
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_claims  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_claims_member_select
  ON public.project_claims FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY project_notices_member_select
  ON public.project_notices FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY project_notices_member_insert
  ON public.project_notices FOR INSERT TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));
