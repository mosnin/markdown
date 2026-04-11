-- =============================================================================
-- Context Store — object model expansion: RPC functions
-- Migration: 20260411000004_object_model_rpc.sql
--
-- Creates:
--   create_object_with_initial_version  — atomically creates version 1 and
--     sets current_version_id on the owning table (files / skills / agents)
--   update_object_and_create_version    — atomically appends a new version and
--     advances current_version_id + source_content on the owning table
--
-- Security: SECURITY INVOKER. RLS on object_versions, files, skills, and
-- agents applies normally via the caller's authenticated JWT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. create_object_with_initial_version
--
--    Atomically:
--      1. Inserts the first object_version row (version_number = 1, no parent)
--      2. Updates current_version_id and content_bytes on the owning table
--
--    Parameters:
--      p_object_type    — 'file' | 'skill' | 'agent'
--      p_object_id      — id of the owning row in files / skills / agents
--      p_workspace_id   — workspace context (informational; ownership enforced
--                         by RLS on object_versions via the owning table)
--      p_actor_id       — auth.users.id (uuid as text) or 'system'
--      p_source_content — full content text for this initial version
--      p_actor_type     — 'user' | 'connection' | 'system'  (default 'user')
--      p_change_origin  — change_origin label  (default 'human_edit')
--
--    Returns: uuid — the new object_versions.id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_object_with_initial_version(
  p_object_type    text,
  p_object_id      uuid,
  p_workspace_id   uuid,
  p_actor_id       text,
  p_source_content text,
  p_actor_type     text DEFAULT 'user',
  p_change_origin  text DEFAULT 'human_edit'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_version_id    uuid;
  v_content_bytes integer;
BEGIN
  v_content_bytes := octet_length(p_source_content::bytea);

  INSERT INTO public.object_versions (
    object_type,
    object_id,
    version_number,
    source_content,
    content_bytes,
    actor_type,
    actor_id,
    change_origin
  )
  VALUES (
    p_object_type,
    p_object_id,
    1,
    p_source_content,
    v_content_bytes,
    p_actor_type,
    p_actor_id,
    p_change_origin
  )
  RETURNING id INTO v_version_id;

  -- Update current_version_id on the owning table.
  IF p_object_type = 'file' THEN
    UPDATE public.files
      SET current_version_id = v_version_id,
          content_bytes      = v_content_bytes
      WHERE id = p_object_id;
  ELSIF p_object_type = 'skill' THEN
    UPDATE public.skills
      SET current_version_id = v_version_id,
          content_bytes      = v_content_bytes
      WHERE id = p_object_id;
  ELSIF p_object_type = 'agent' THEN
    UPDATE public.agents
      SET current_version_id = v_version_id,
          content_bytes      = v_content_bytes
      WHERE id = p_object_id;
  END IF;

  RETURN v_version_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. update_object_and_create_version
--
--    Atomically:
--      1. Reads the current max version_number (and its id as the new parent)
--      2. Inserts a new object_version row (version_number = max + 1)
--      3. Updates current_version_id, source_content, content_bytes, and
--         updated_at on the owning table
--
--    Parameters:
--      p_object_type    — 'file' | 'skill' | 'agent'
--      p_object_id      — id of the owning row
--      p_actor_id       — auth.users.id (uuid as text) or 'system'
--      p_source_content — full updated content text
--      p_diff_summary   — optional jsonb diff summary (default NULL)
--      p_change_origin  — change_origin label  (default 'human_edit')
--      p_actor_type     — 'user' | 'connection' | 'system'  (default 'user')
--
--    Returns: uuid — the new object_versions.id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_object_and_create_version(
  p_object_type    text,
  p_object_id      uuid,
  p_actor_id       text,
  p_source_content text,
  p_diff_summary   jsonb DEFAULT NULL,
  p_change_origin  text  DEFAULT 'human_edit',
  p_actor_type     text  DEFAULT 'user'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_version_id       uuid;
  v_prev_version_id  uuid;
  v_next_version_num integer;
  v_content_bytes    integer;
BEGIN
  v_content_bytes := octet_length(p_source_content::bytea);

  -- Get the current highest version id and compute the next version number.
  SELECT id, version_number + 1
    INTO v_prev_version_id, v_next_version_num
    FROM public.object_versions
   WHERE object_type = p_object_type
     AND object_id   = p_object_id
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_next_version_num IS NULL THEN
    v_next_version_num := 1;
  END IF;

  INSERT INTO public.object_versions (
    object_type,
    object_id,
    parent_version_id,
    version_number,
    source_content,
    content_bytes,
    actor_type,
    actor_id,
    change_origin,
    diff_summary
  )
  VALUES (
    p_object_type,
    p_object_id,
    v_prev_version_id,
    v_next_version_num,
    p_source_content,
    v_content_bytes,
    p_actor_type,
    p_actor_id,
    p_change_origin,
    p_diff_summary
  )
  RETURNING id INTO v_version_id;

  -- Advance owning table to reflect new version.
  IF p_object_type = 'file' THEN
    UPDATE public.files
      SET current_version_id = v_version_id,
          source_content     = p_source_content,
          content_bytes      = v_content_bytes,
          updated_at         = now()
      WHERE id = p_object_id;
  ELSIF p_object_type = 'skill' THEN
    UPDATE public.skills
      SET current_version_id = v_version_id,
          source_content     = p_source_content,
          content_bytes      = v_content_bytes,
          updated_at         = now()
      WHERE id = p_object_id;
  ELSIF p_object_type = 'agent' THEN
    UPDATE public.agents
      SET current_version_id = v_version_id,
          source_content     = p_source_content,
          content_bytes      = v_content_bytes,
          updated_at         = now()
      WHERE id = p_object_id;
  END IF;

  RETURN v_version_id;
END;
$$;
