-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: atomic note RPC functions
--
-- These plpgsql functions provide transactional guarantees for note creation
-- and editing. Each function runs as a single transaction — either the note
-- and its version are both written, or neither is.
--
-- Security: SECURITY INVOKER (default). RLS policies apply normally because
-- the Supabase client passes the authenticated user's JWT.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── create_note_with_initial_version ────────────────────────────────────────
--
-- Atomically:
--   1. INSERT note (current_version_id initially NULL)
--   2. INSERT note_versions row (version_number = 1, no parent)
--   3. UPDATE note SET current_version_id = new version id
--
-- Returns jsonb: { note: {...}, version: {...} }
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_note_with_initial_version(
  p_box_id              uuid,
  p_folder_id           uuid,
  p_title               text,
  p_slug                text,
  p_path_cache          text,
  p_markdown_content    text,
  p_summary             text,
  p_tags                text[],
  p_read_hint           text,
  p_retrieval_priority  integer,
  p_kind                text,
  p_actor_id            text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_note     notes;
  v_version  note_versions;
  v_bytes    integer;
BEGIN
  v_bytes := octet_length(p_markdown_content);

  -- Step 1: Insert the note (current_version_id is NULL until step 3)
  INSERT INTO notes (
    box_id, folder_id, title, slug, path_cache,
    markdown_content, content_bytes,
    summary, tags, read_hint, retrieval_priority, kind,
    origin_type, status
  ) VALUES (
    p_box_id,
    p_folder_id,
    p_title,
    p_slug,
    p_path_cache,
    p_markdown_content,
    v_bytes,
    p_summary,
    COALESCE(p_tags, '{}'),
    p_read_hint,
    COALESCE(p_retrieval_priority, 0),
    COALESCE(p_kind, 'note'),
    'human',
    'active'
  )
  RETURNING * INTO v_note;

  -- Step 2: Create the initial version snapshot
  INSERT INTO note_versions (
    note_id, parent_version_id, version_number,
    title, markdown_content, content_bytes,
    actor_type, actor_id, change_origin
  ) VALUES (
    v_note.id,
    NULL,
    1,
    v_note.title,
    v_note.markdown_content,
    v_note.content_bytes,
    'user',
    p_actor_id,
    'human_edit'
  )
  RETURNING * INTO v_version;

  -- Step 3: Link note to its initial version
  UPDATE notes
    SET current_version_id = v_version.id
  WHERE id = v_note.id
  RETURNING * INTO v_note;

  RETURN jsonb_build_object(
    'note',    to_jsonb(v_note),
    'version', to_jsonb(v_version)
  );
END;
$$;

-- ─── update_note_and_create_version ──────────────────────────────────────────
--
-- Atomically:
--   1. SELECT current note state (RLS rejects if not authorised)
--   2. INSERT note_versions row (version_number = MAX + 1)
--   3. UPDATE note content fields + current_version_id
--
-- Returns jsonb: { note: {...}, version: {...} }
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_note_and_create_version(
  p_note_id             uuid,
  p_title               text,
  p_markdown_content    text,
  p_summary             text,
  p_tags                text[],
  p_read_hint           text,
  p_actor_id            text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_note      notes;
  v_version   note_versions;
  v_next_num  integer;
  v_bytes     integer;
BEGIN
  -- Step 1: Fetch current note — RLS blocks unauthorised access
  SELECT * INTO v_note FROM notes WHERE id = p_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % not found or not accessible', p_note_id;
  END IF;

  v_bytes := octet_length(p_markdown_content);

  -- Step 2: Determine next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_num
    FROM note_versions
   WHERE note_id = p_note_id;

  -- Step 3: Insert new version (parent = current version)
  INSERT INTO note_versions (
    note_id, parent_version_id, version_number,
    title, markdown_content, content_bytes,
    actor_type, actor_id, change_origin
  ) VALUES (
    p_note_id,
    v_note.current_version_id,
    v_next_num,
    p_title,
    p_markdown_content,
    v_bytes,
    'user',
    p_actor_id,
    'human_edit'
  )
  RETURNING * INTO v_version;

  -- Step 4: Update note content and advance current_version_id
  UPDATE notes SET
    title              = p_title,
    markdown_content   = p_markdown_content,
    content_bytes      = v_bytes,
    summary            = p_summary,
    tags               = COALESCE(p_tags, '{}'),
    read_hint          = p_read_hint,
    current_version_id = v_version.id
  WHERE id = p_note_id
  RETURNING * INTO v_note;

  RETURN jsonb_build_object(
    'note',    to_jsonb(v_note),
    'version', to_jsonb(v_version)
  );
END;
$$;
