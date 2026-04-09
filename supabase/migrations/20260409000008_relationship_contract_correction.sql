-- =============================================================================
-- Context Store — relationship contract correction
-- Migration: 20260409000008_relationship_contract_correction.sql
--
-- Corrects the note_links vocabulary to match the original Context Store
-- relationship contract and adds relationship_note as a first-class field.
--
-- Changes:
--   1. Add relationship_note TEXT nullable column to note_links
--   2. Migrate stale relationship_type values:
--        references  → reference_for
--        contradicts → related
--   3. Drop the old 5-value CHECK constraint
--   4. Add new 10-value CHECK constraint with canonical vocabulary
--   5. Update search_notes RPC to include relationship_note as a
--      searchable field (via EXISTS subquery — no schema denormalization)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add relationship_note column
-- ---------------------------------------------------------------------------

ALTER TABLE public.note_links
  ADD COLUMN IF NOT EXISTS relationship_note text;

-- ---------------------------------------------------------------------------
-- 2. Migrate stale relationship_type values
--    All existing rows with old types are deterministically remapped:
--      'references'  → 'reference_for'  (semantic rename — same meaning)
--      'contradicts' → 'related'        (conservative fallback)
-- ---------------------------------------------------------------------------

UPDATE public.note_links
  SET relationship_type = 'reference_for'
  WHERE relationship_type = 'references';

UPDATE public.note_links
  SET relationship_type = 'related'
  WHERE relationship_type = 'contradicts';

-- ---------------------------------------------------------------------------
-- 3. Drop old 5-value CHECK constraint
--    The inline CHECK without a name gets the default auto-name.
-- ---------------------------------------------------------------------------

ALTER TABLE public.note_links
  DROP CONSTRAINT IF EXISTS note_links_relationship_type_check;

-- ---------------------------------------------------------------------------
-- 4. Add new 10-value CHECK constraint
--
--    Canonical relationship vocabulary:
--      related        — general association (symmetric in spirit)
--      depends_on     — source note's meaning depends on target
--      parent_of      — source is a conceptual parent of target
--      child_of       — source is a conceptual child of target
--      reference_for  — source is cited as a reference for target
--      extends        — source builds upon or continues target
--      example_of     — source is a concrete example of target
--      sibling_of     — source and target are peer-level siblings
--      supersedes     — source replaces or supersedes target
--      derived_from   — source was derived or extracted from target
-- ---------------------------------------------------------------------------

ALTER TABLE public.note_links
  ADD CONSTRAINT note_links_relationship_type_check
  CHECK (relationship_type IN (
    'related',
    'depends_on',
    'parent_of',
    'child_of',
    'reference_for',
    'extends',
    'example_of',
    'sibling_of',
    'supersedes',
    'derived_from'
  ));

-- GIN index for FTS on relationship_note (optional but useful for large sets)
CREATE INDEX IF NOT EXISTS note_links_relationship_note_idx
  ON public.note_links USING GIN (
    to_tsvector('english', coalesce(relationship_note, ''))
  )
  WHERE relationship_note IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Update search_notes RPC to include relationship_note
--
--    A note now appears in search results if:
--      a) Its FTS search_vector matches the query (title/tags/summary/content)
--      b) Its title prefix matches the query
--      c) Any link connected to it has a relationship_note that matches
--
--    The relationship_note match uses an EXISTS subquery to avoid row
--    duplication from JOIN on note_links.
--
--    search_vector column on notes is NOT changed — relationship_note is
--    denormalized per-link, not per-note. The subquery is intentionally
--    simple and indexed.
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
      -- relationship_note match: any link (either direction) with matching note
      OR EXISTS (
        SELECT 1
        FROM public.note_links nl
        WHERE
          (nl.source_note_id = n.id OR nl.target_note_id = n.id)
          AND nl.relationship_note IS NOT NULL
          AND to_tsvector('english', nl.relationship_note) @@ v_tsquery
      )
    )
  ORDER BY rank DESC, n.updated_at DESC
  LIMIT p_limit;
END;
$$;
