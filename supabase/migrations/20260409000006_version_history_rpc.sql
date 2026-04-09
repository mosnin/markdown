-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: version history RPC functions
--
-- 1. Extends the change_origin CHECK constraint to include 'rollback'.
-- 2. Replaces update_note_and_create_version with a version that accepts an
--    optional p_diff_summary parameter (backward compatible — existing callers
--    can omit it and receive NULL in the stored row).
-- 3. Adds rollback_note_to_version: locks the note, verifies the target version
--    belongs to the note, creates a fresh version from the snapshot, and
--    advances current_version_id — all in one transaction.
--
-- Security: SECURITY INVOKER (default). The human app calls this via the admin
-- client (service role) after verifying ownership in the service layer.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Extend change_origin constraint ──────────────────────────────────────

ALTER TABLE public.note_versions
  DROP CONSTRAINT IF EXISTS note_versions_change_origin_check;

ALTER TABLE public.note_versions
  ADD CONSTRAINT note_versions_change_origin_check
  CHECK (change_origin IN (
    'human_edit',
    'import',
    'generated',
    'proposal_approved',
    'rollback'
  ));

-- ─── 2. update_note_and_create_version (with diff_summary) ───────────────────
--
-- Backward compatible: p_diff_summary defaults to NULL. Callers that previously
-- omitted this parameter continue to work without changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_note_and_create_version(
  p_note_id             uuid,
  p_title               text,
  p_markdown_content    text,
  p_summary             text,
  p_tags                text[],
  p_read_hint           text,
  p_actor_id            text,
  p_diff_summary        jsonb    DEFAULT NULL,
  p_change_origin       text     DEFAULT 'human_edit'
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
  -- Fetch current note — RLS blocks unauthorised access
  SELECT * INTO v_note FROM notes WHERE id = p_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % not found or not accessible', p_note_id;
  END IF;

  v_bytes := octet_length(p_markdown_content);

  -- Determine next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_num
    FROM note_versions
   WHERE note_id = p_note_id;

  -- Insert new version (parent = current version)
  INSERT INTO note_versions (
    note_id, parent_version_id, version_number,
    title, markdown_content, content_bytes,
    actor_type, actor_id, change_origin, diff_summary
  ) VALUES (
    p_note_id,
    v_note.current_version_id,
    v_next_num,
    p_title,
    p_markdown_content,
    v_bytes,
    'user',
    p_actor_id,
    COALESCE(p_change_origin, 'human_edit'),
    p_diff_summary
  )
  RETURNING * INTO v_version;

  -- Update note content and advance current_version_id
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

-- ─── 3. rollback_note_to_version ─────────────────────────────────────────────
--
-- Creates a new note_version whose content is a copy of the selected historical
-- snapshot, then advances the note to point at this new version.
--
-- Immutability guarantee: the target historical version row is never touched.
-- The rollback is represented as a brand new version with change_origin='rollback'
-- and parent_version_id pointing at the note's current version at call time.
--
-- Parameters:
--   p_note_id          — note to roll back
--   p_target_version_id — version whose snapshot to restore
--   p_actor_id         — user id performing the rollback
--   p_diff_summary     — pre-computed diff_summary from the service layer
--
-- Returns jsonb: { new_version_id: uuid, version_number: integer }
--   or raises an exception if the target version does not belong to the note.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rollback_note_to_version(
  p_note_id           uuid,
  p_target_version_id uuid,
  p_actor_id          text,
  p_diff_summary      jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_note       notes;
  v_snap       note_versions;
  v_new_ver    note_versions;
  v_next_num   integer;
  v_bytes      integer;
BEGIN
  -- Lock note row for update to prevent concurrent version races
  SELECT * INTO v_note
    FROM notes
   WHERE id = p_note_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % not found or not accessible', p_note_id;
  END IF;

  -- Load and verify target version belongs to this note
  SELECT * INTO v_snap
    FROM note_versions
   WHERE id = p_target_version_id
     AND note_id = p_note_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version % does not belong to note %',
      p_target_version_id, p_note_id;
  END IF;

  v_bytes := octet_length(v_snap.markdown_content);

  -- Determine next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_num
    FROM note_versions
   WHERE note_id = p_note_id;

  -- Create rollback version from snapshot content
  INSERT INTO note_versions (
    note_id, parent_version_id, version_number,
    title, markdown_content, content_bytes,
    actor_type, actor_id, change_origin, diff_summary
  ) VALUES (
    p_note_id,
    v_note.current_version_id,   -- parent = the version we're rolling back from
    v_next_num,
    v_snap.title,
    v_snap.markdown_content,
    v_bytes,
    'user',
    p_actor_id,
    'rollback',
    p_diff_summary
  )
  RETURNING * INTO v_new_ver;

  -- Advance note to the new rollback version
  UPDATE notes SET
    title              = v_snap.title,
    markdown_content   = v_snap.markdown_content,
    content_bytes      = v_bytes,
    current_version_id = v_new_ver.id
  WHERE id = p_note_id;

  RETURN jsonb_build_object(
    'new_version_id',  v_new_ver.id,
    'version_number',  v_new_ver.version_number
  );
END;
$$;
