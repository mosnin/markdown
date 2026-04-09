-- =============================================================================
-- Context Store — full-text search indexes
-- Migration: 20260409000004_fts_indexes.sql
--
-- Adds a stored tsvector column (search_vector) to notes, maintained by
-- trigger, with a GIN index for fast full-text queries.
--
-- Weighted fields:
--   A — title, tags     (highest priority)
--   B — summary, read_hint
--   C — markdown_content (largest, lowest weight)
--
-- Also adds an RPC function (search_notes) for ranked full-text retrieval
-- with deterministic tie-breaking.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. search_vector column
-- ---------------------------------------------------------------------------

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- ---------------------------------------------------------------------------
-- 2. Trigger function: maintain search_vector on insert/update
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notes_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(NEW.tags, ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.read_hint, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.markdown_content, '')), 'C');
  RETURN NEW;
END;
$$;

CREATE TRIGGER notes_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, tags, summary, read_hint, markdown_content
  ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes_search_vector_update();

-- ---------------------------------------------------------------------------
-- 3. GIN index for FTS queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS notes_search_vector_idx
  ON public.notes USING GIN (search_vector);

-- ---------------------------------------------------------------------------
-- 4. Backfill existing rows
-- ---------------------------------------------------------------------------

UPDATE public.notes SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', array_to_string(tags, ' ')), 'A') ||
  setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(read_hint, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(markdown_content, '')), 'C');

-- ---------------------------------------------------------------------------
-- 5. RPC: search_notes
--
--    Returns notes within a box ranked by full-text relevance.
--    Deterministic ranking:
--      1. Exact title match (highest boost)
--      2. Title prefix match
--      3. ts_rank_cd weighted score
--      4. retrieval_priority (desc)
--      5. updated_at (desc) — tie-break
--
--    SECURITY INVOKER — caller's RLS policies apply.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_notes(
  p_box_id     uuid,
  p_query      text,
  p_limit      integer DEFAULT 20
)
RETURNS TABLE (
  id                   uuid,
  box_id               uuid,
  folder_id            uuid,
  current_version_id   uuid,
  title                text,
  slug                 text,
  path_cache           text,
  markdown_content     text,
  content_bytes        integer,
  summary              text,
  tags                 text[],
  read_hint            text,
  retrieval_priority   integer,
  kind                 text,
  status               text,
  origin_type          text,
  is_generated         boolean,
  generated_by_connection_id uuid,
  created_at           timestamptz,
  updated_at           timestamptz,
  rank                 real
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_tsquery tsquery;
BEGIN
  -- Safely parse the query; return no rows if blank or unparseable
  IF btrim(p_query) = '' THEN
    RETURN;
  END IF;

  BEGIN
    v_tsquery := plainto_tsquery('english', p_query);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
  SELECT
    n.id,
    n.box_id,
    n.folder_id,
    n.current_version_id,
    n.title,
    n.slug,
    n.path_cache,
    n.markdown_content,
    n.content_bytes,
    n.summary,
    n.tags,
    n.read_hint,
    n.retrieval_priority,
    n.kind,
    n.status,
    n.origin_type,
    n.is_generated,
    n.generated_by_connection_id,
    n.created_at,
    n.updated_at,
    (
      -- exact title match boost
      CASE WHEN lower(n.title) = lower(p_query) THEN 4.0 ELSE 0.0 END +
      -- prefix title boost
      CASE WHEN lower(n.title) LIKE lower(p_query) || '%' THEN 2.0 ELSE 0.0 END +
      -- weighted FTS score
      ts_rank_cd(n.search_vector, v_tsquery, 32) * 10.0 +
      -- retrieval_priority nudge (normalised 0–1)
      n.retrieval_priority::real / 10.0
    )::real AS rank
  FROM public.notes n
  WHERE
    n.box_id    = p_box_id
    AND n.status = 'active'
    AND (
      n.search_vector @@ v_tsquery
      OR lower(n.title) LIKE lower(p_query) || '%'
    )
  ORDER BY rank DESC, n.updated_at DESC
  LIMIT p_limit;
END;
$$;
