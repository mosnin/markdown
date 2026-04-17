-- =============================================================================
-- Context Store — full-text search indexes for skills, agents, files
-- Migration: 20260414000008_fts_skills_agents_files.sql
--
-- Mirrors the pattern from 20260409000004_fts_indexes.sql (notes FTS) and
-- extends it to skills, agents, and files.
--
-- Each table gets:
--   1. A stored tsvector column (search_vector)
--   2. A trigger function to maintain the column on insert/update
--   3. A GIN index for fast full-text queries
--   4. Backfill of existing rows
--   5. An RPC function for ranked full-text retrieval
--
-- Weighted fields:
--   skills: A = name + tags, B = description, C = source_content
--   agents: A = name + tags, B = description + system_prompt, C = source_content
--   files:  A = name, B = description (if present), C = source_content (text-based only)
-- =============================================================================

-- ===========================================================================
--  SKILLS
-- ===========================================================================

-- 1. search_vector column
ALTER TABLE public.skills
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Trigger function
CREATE OR REPLACE FUNCTION public.skills_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(NEW.tags, ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.source_content, '')), 'C');
  RETURN NEW;
END;
$$;

CREATE TRIGGER skills_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, tags, description, source_content
  ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.skills_search_vector_update();

-- 3. GIN index
CREATE INDEX IF NOT EXISTS skills_search_vector_idx
  ON public.skills USING GIN (search_vector);

-- 4. Backfill existing rows
UPDATE public.skills SET search_vector =
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', array_to_string(tags, ' ')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(source_content, '')), 'C');

-- 5. RPC: search_skills
CREATE OR REPLACE FUNCTION public.search_skills(
  p_workspace_id uuid,
  p_query        text,
  p_limit        integer DEFAULT 20
)
RETURNS TABLE (
  id                  uuid,
  workspace_id        uuid,
  box_id              uuid,
  folder_id           uuid,
  name                text,
  slug                text,
  path_cache          text,
  source_content      text,
  content_bytes       integer,
  canonical_format    text,
  description         text,
  summary             text,
  tags                text[],
  is_reusable         boolean,
  status              text,
  current_version_id  uuid,
  origin_type         text,
  created_at          timestamptz,
  updated_at          timestamptz,
  rank                real
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_tsquery tsquery;
BEGIN
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
    s.id,
    s.workspace_id,
    s.box_id,
    s.folder_id,
    s.name,
    s.slug,
    s.path_cache,
    s.source_content,
    s.content_bytes,
    s.canonical_format,
    s.description,
    s.summary,
    s.tags,
    s.is_reusable,
    s.status,
    s.current_version_id,
    s.origin_type,
    s.created_at,
    s.updated_at,
    (
      CASE WHEN lower(s.name) = lower(p_query) THEN 4.0 ELSE 0.0 END +
      CASE WHEN lower(s.name) LIKE lower(p_query) || '%' THEN 2.0 ELSE 0.0 END +
      ts_rank_cd(s.search_vector, v_tsquery, 32) * 10.0
    )::real AS rank
  FROM public.skills s
  WHERE
    s.workspace_id = p_workspace_id
    AND s.status = 'active'
    AND (
      s.search_vector @@ v_tsquery
      OR lower(s.name) LIKE lower(p_query) || '%'
    )
  ORDER BY rank DESC, s.updated_at DESC
  LIMIT p_limit;
END;
$$;

-- ===========================================================================
--  AGENTS
-- ===========================================================================

-- 1. search_vector column
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Trigger function
CREATE OR REPLACE FUNCTION public.agents_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(NEW.tags, ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.system_prompt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.source_content, '')), 'C');
  RETURN NEW;
END;
$$;

CREATE TRIGGER agents_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, tags, description, system_prompt, source_content
  ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.agents_search_vector_update();

-- 3. GIN index
CREATE INDEX IF NOT EXISTS agents_search_vector_idx
  ON public.agents USING GIN (search_vector);

-- 4. Backfill existing rows
UPDATE public.agents SET search_vector =
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', array_to_string(tags, ' ')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(system_prompt, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(source_content, '')), 'C');

-- 5. RPC: search_agents
CREATE OR REPLACE FUNCTION public.search_agents(
  p_workspace_id uuid,
  p_query        text,
  p_limit        integer DEFAULT 20
)
RETURNS TABLE (
  id                  uuid,
  workspace_id        uuid,
  box_id              uuid,
  folder_id           uuid,
  name                text,
  slug                text,
  path_cache          text,
  source_content      text,
  content_bytes       integer,
  canonical_format    text,
  agent_type          text,
  model_hint          text,
  system_prompt       text,
  description         text,
  summary             text,
  tags                text[],
  is_reusable         boolean,
  status              text,
  current_version_id  uuid,
  origin_type         text,
  created_at          timestamptz,
  updated_at          timestamptz,
  rank                real
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_tsquery tsquery;
BEGIN
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
    a.id,
    a.workspace_id,
    a.box_id,
    a.folder_id,
    a.name,
    a.slug,
    a.path_cache,
    a.source_content,
    a.content_bytes,
    a.canonical_format,
    a.agent_type,
    a.model_hint,
    a.system_prompt,
    a.description,
    a.summary,
    a.tags,
    a.is_reusable,
    a.status,
    a.current_version_id,
    a.origin_type,
    a.created_at,
    a.updated_at,
    (
      CASE WHEN lower(a.name) = lower(p_query) THEN 4.0 ELSE 0.0 END +
      CASE WHEN lower(a.name) LIKE lower(p_query) || '%' THEN 2.0 ELSE 0.0 END +
      ts_rank_cd(a.search_vector, v_tsquery, 32) * 10.0
    )::real AS rank
  FROM public.agents a
  WHERE
    a.workspace_id = p_workspace_id
    AND a.status = 'active'
    AND (
      a.search_vector @@ v_tsquery
      OR lower(a.name) LIKE lower(p_query) || '%'
    )
  ORDER BY rank DESC, a.updated_at DESC
  LIMIT p_limit;
END;
$$;

-- ===========================================================================
--  FILES
-- ===========================================================================

-- 1. search_vector column
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Trigger function
--    For files, we index source_content only when the format is text-based
--    (i.e. canonical_format <> 'binary'). Binary content is not meaningful
--    for FTS.
CREATE OR REPLACE FUNCTION public.files_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    CASE
      WHEN NEW.canonical_format <> 'binary'
        THEN setweight(to_tsvector('english', coalesce(NEW.source_content, '')), 'C')
      ELSE ''::tsvector
    END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER files_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, description, source_content, canonical_format
  ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.files_search_vector_update();

-- 3. GIN index
CREATE INDEX IF NOT EXISTS files_search_vector_idx
  ON public.files USING GIN (search_vector);

-- 4. Backfill existing rows
UPDATE public.files SET search_vector =
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  CASE
    WHEN canonical_format <> 'binary'
      THEN setweight(to_tsvector('english', coalesce(source_content, '')), 'C')
    ELSE ''::tsvector
  END;

-- 5. RPC: search_files
CREATE OR REPLACE FUNCTION public.search_files(
  p_workspace_id uuid,
  p_query        text,
  p_limit        integer DEFAULT 20
)
RETURNS TABLE (
  id                  uuid,
  workspace_id        uuid,
  box_id              uuid,
  folder_id           uuid,
  name                text,
  slug                text,
  path_cache          text,
  source_content      text,
  content_bytes       integer,
  canonical_format    text,
  source_language     text,
  file_extension      text,
  mime_type           text,
  description         text,
  tags                text[],
  summary             text,
  status              text,
  current_version_id  uuid,
  origin_type         text,
  created_at          timestamptz,
  updated_at          timestamptz,
  rank                real
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  v_tsquery tsquery;
BEGIN
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
    f.id,
    f.workspace_id,
    f.box_id,
    f.folder_id,
    f.name,
    f.slug,
    f.path_cache,
    f.source_content,
    f.content_bytes,
    f.canonical_format,
    f.source_language,
    f.file_extension,
    f.mime_type,
    f.description,
    f.tags,
    f.summary,
    f.status,
    f.current_version_id,
    f.origin_type,
    f.created_at,
    f.updated_at,
    (
      CASE WHEN lower(f.name) = lower(p_query) THEN 4.0 ELSE 0.0 END +
      CASE WHEN lower(f.name) LIKE lower(p_query) || '%' THEN 2.0 ELSE 0.0 END +
      ts_rank_cd(f.search_vector, v_tsquery, 32) * 10.0
    )::real AS rank
  FROM public.files f
  WHERE
    f.workspace_id = p_workspace_id
    AND f.status = 'active'
    AND (
      f.search_vector @@ v_tsquery
      OR lower(f.name) LIKE lower(p_query) || '%'
    )
  ORDER BY rank DESC, f.updated_at DESC
  LIMIT p_limit;
END;
$$;
