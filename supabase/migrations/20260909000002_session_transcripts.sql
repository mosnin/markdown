-- =============================================================================
-- Session transcripts — the conversation layer
-- Migration: 20260909000002_session_transcripts.sql
--
-- 20260909000001 gave us what agents CONCLUDED: summaries, checkpoints, briefs.
-- This migration stores what they actually SAID.
--
-- Why both. A brief tells the next agent where to go. It cannot tell it why the
-- last three approaches died — that reasoning only exists in the conversation,
-- and it is the single most expensive thing to rediscover. Claude Code hands us
-- `transcript_path` on every hook invocation; this is where that content lands.
--
-- The governing principle for what we keep, at full fidelity and at what cost:
--
--   PRESERVE WHAT CANNOT BE RECONSTRUCTED. DROP WHAT CAN.
--
-- An assistant's reasoning ("I tried the Stripe replay assertion, it fails
-- because test mode dedupes within 60s") exists nowhere else in the universe
-- once the process exits. A file's contents, a grep result, an `ls` — all
-- re-derivable from the repo in one tool call. So reasoning is stored verbatim
-- and tool output is truncated aggressively. This is the same opinion the
-- brief assembler's priority order encodes, applied one layer down.
--
-- Storage shape: segments live in Postgres, not object storage. They ARE the
-- retrieval unit — every search result is a segment — so putting bodies behind
-- an object fetch would add a round trip to the hot path and take them out of
-- reach of FTS and pgvector. Postgres TOAST compresses multi-KB text well.
-- `raw_storage_path` is reserved for archiving the untouched original
-- alongside, which is a fidelity/export concern rather than a retrieval one.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. session_transcripts
--
--    One row per session. Chiefly a cursor: `last_ingested_offset` is how many
--    bytes of the source file we have already parsed, which is what makes
--    ingest incremental.
--
--    That matters more than it looks. A three-hour session's transcript is
--    megabytes. Shipping the whole file on every PreCompact would be absurd;
--    shipping the bytes appended since last time is cheap enough to do often.
-- ---------------------------------------------------------------------------

CREATE TABLE public.session_transcripts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id            uuid        NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,

  source_format         text        NOT NULL DEFAULT 'plain'
                                    CHECK (source_format IN (
                                      'claude_code_jsonl', 'codex_jsonl', 'plain', 'custom'
                                    )),

  -- Parse cursor. Bytes of the source consumed so far; a client sends
  -- everything after this offset and we append what it parses to.
  last_ingested_offset  bigint      NOT NULL DEFAULT 0 CHECK (last_ingested_offset >= 0),

  byte_count            bigint      NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  segment_count         integer     NOT NULL DEFAULT 0 CHECK (segment_count >= 0),
  message_count         integer     NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  -- Sum of segment token estimates. Lets the UI say "1.2M tokens of
  -- conversation" without scanning the segments.
  token_estimate        bigint      NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),

  -- Reserved for an archive of the untouched original. Not populated yet;
  -- present so adding the archive path later needs no migration.
  raw_storage_path      text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (session_id)
);

CREATE INDEX session_transcripts_project_idx
  ON public.session_transcripts (project_id, updated_at DESC);

CREATE TRIGGER session_transcripts_set_updated_at
  BEFORE UPDATE ON public.session_transcripts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. transcript_segments
--
--    The retrieval unit. One coherent piece of conversation: a prompt, a block
--    of assistant reasoning, a tool call, or a (truncated) tool result.
--
--    `ordinal` is dense and monotonic per transcript, which is what makes
--    "give me the 8 segments around this hit" a range scan rather than a
--    timestamp guess. Reading a search result in context is the whole point —
--    an isolated matching paragraph is usually not enough to act on.
--
--    `kind` drives both retrieval weighting and truncation policy:
--      prompt       what the human asked for            — never truncated
--      reasoning    what the agent thought              — never truncated
--      tool_call    what it decided to do               — args only
--      tool_result  what came back                      — truncated hard
--      summary      a compaction summary the agent wrote — never truncated
-- ---------------------------------------------------------------------------

CREATE TABLE public.transcript_segments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id     uuid        NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  transcript_id  uuid        NOT NULL REFERENCES public.session_transcripts(id) ON DELETE CASCADE,

  ordinal        integer     NOT NULL CHECK (ordinal >= 0),

  role           text        NOT NULL DEFAULT 'assistant'
                             CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  kind           text        NOT NULL DEFAULT 'reasoning'
                             CHECK (kind IN (
                               'prompt', 'reasoning', 'tool_call', 'tool_result', 'summary'
                             )),

  content        text        NOT NULL CHECK (char_length(content) > 0),
  token_estimate integer     NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),

  tool_name      text,
  files          text[]      NOT NULL DEFAULT '{}',

  -- Same 0–5 salience scale as session_events. Search ranks on it so a
  -- reasoning segment outranks a directory listing that matched the same word.
  importance     smallint    NOT NULL DEFAULT 2
                             CHECK (importance BETWEEN 0 AND 5),

  -- True when the body was cut down at ingest (tool output, mostly), so a
  -- reader knows it is looking at a fragment rather than the whole thing.
  truncated      boolean     NOT NULL DEFAULT false,

  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Keyword search. Generated rather than trigger-maintained: segments are
  -- immutable once written, so there is nothing to keep in sync.
  fts            tsvector    GENERATED ALWAYS AS (
                               to_tsvector('english', coalesce(content, ''))
                             ) STORED,

  UNIQUE (transcript_id, ordinal)
);

CREATE INDEX transcript_segments_fts_idx
  ON public.transcript_segments USING gin (fts);
-- The context-window read: segments N-4 .. N+4 of one session.
CREATE INDEX transcript_segments_session_ordinal_idx
  ON public.transcript_segments (session_id, ordinal);
CREATE INDEX transcript_segments_project_idx
  ON public.transcript_segments (project_id, occurred_at DESC);
-- Ranked keyword search skips the noise floor entirely.
CREATE INDEX transcript_segments_salient_idx
  ON public.transcript_segments (project_id, importance DESC, occurred_at DESC)
  WHERE importance >= 3;
CREATE INDEX transcript_segments_files_idx
  ON public.transcript_segments USING gin (files);

-- ---------------------------------------------------------------------------
-- 3. transcript_segment_embeddings
--
--    Separate table, mirroring note_embeddings: embeddings are optional (the
--    deployment may have no EMBEDDING_API_KEY), generated asynchronously, and
--    re-generated when the model changes. Keeping them out of the segment row
--    means ingest never waits on an embedding API call — search falls back to
--    FTS until the backfill catches up, which is a real, working degradation
--    rather than an outage.
-- ---------------------------------------------------------------------------

CREATE TABLE public.transcript_segment_embeddings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id   uuid        NOT NULL REFERENCES public.transcript_segments(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  embedding    vector(1536),
  model        text        NOT NULL DEFAULT 'text-embedding-3-small',
  content_hash text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (segment_id)
);

CREATE INDEX transcript_segment_embeddings_vec_idx
  ON public.transcript_segment_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX transcript_segment_embeddings_project_idx
  ON public.transcript_segment_embeddings (project_id);

-- ---------------------------------------------------------------------------
-- 4. match_transcript_segments()
--
--    Vector search over conversation, scoped to a workspace and optionally one
--    project. Mirrors match_note_embeddings so the calling convention in
--    embedding_service.ts carries over unchanged.
--
--    Similarity is blended with salience before ordering: a half-relevant piece
--    of reasoning beats a highly-similar `ls` dump, because the reasoning is
--    the part that cannot be recovered by looking at the repo. The 0.85/0.15
--    split keeps similarity dominant while letting salience break near-ties.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_transcript_segments(
  query_embedding    vector(1536),
  match_workspace_id uuid,
  match_project_id   uuid DEFAULT NULL,
  match_limit        int  DEFAULT 20,
  min_importance     int  DEFAULT 0
)
RETURNS TABLE(
  segment_id  uuid,
  session_id  uuid,
  ordinal     integer,
  role        text,
  kind        text,
  content     text,
  tool_name   text,
  importance  smallint,
  occurred_at timestamptz,
  similarity  float8,
  score       float8
)
LANGUAGE SQL STABLE AS $$
  SELECT
    ts.id,
    ts.session_id,
    ts.ordinal,
    ts.role,
    ts.kind,
    ts.content,
    ts.tool_name,
    ts.importance,
    ts.occurred_at,
    1 - (tse.embedding <=> query_embedding) AS similarity,
    (0.85 * (1 - (tse.embedding <=> query_embedding)))
      + (0.15 * (ts.importance::float8 / 5.0)) AS score
  FROM public.transcript_segment_embeddings tse
  JOIN public.transcript_segments ts ON ts.id = tse.segment_id
  WHERE tse.workspace_id = match_workspace_id
    AND (match_project_id IS NULL OR ts.project_id = match_project_id)
    AND ts.importance >= min_importance
  ORDER BY score DESC
  LIMIT match_limit;
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS
--
--    Reads: workspace members. Writes: service role only — transcripts arrive
--    from machine tokens and, like the event log, are append-only. There is no
--    UI path that rewrites what an agent said.
-- ---------------------------------------------------------------------------

ALTER TABLE public.session_transcripts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segment_embeddings  ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_transcripts_member_select
  ON public.session_transcripts FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY transcript_segments_member_select
  ON public.transcript_segments FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY transcript_segment_embeddings_member_select
  ON public.transcript_segment_embeddings FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

REVOKE ALL ON FUNCTION public.match_transcript_segments(vector, uuid, uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_transcript_segments(vector, uuid, uuid, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_transcript_segments(vector, uuid, uuid, int, int) TO authenticated;
