-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: generated note promotion
--
-- 1. Extends the change_origin CHECK constraint to include 'promotion'.
-- 2. Adds promote_generated_note: verifies the note is currently generated,
--    creates a new note_version with change_origin='promotion', and sets
--    is_generated=false on the note — all in one transaction.
--
-- Design decision: promotion creates a new note_version (not a metadata-only
-- update) so the state transition is legible in version history. The new version
-- carries the same title and markdown content as the current version — no
-- content change occurs. The new version's change_origin='promotion' makes the
-- event machine-readable and unambiguous. This is consistent with how rollback
-- is implemented (also creates a new version from an existing snapshot).
--
-- After promotion:
--   notes.is_generated            → false
--   notes.origin_type             → unchanged (historically 'generated_by_tool')
--   notes.generated_by_connection_id → unchanged (preserved for provenance)
--   notes.current_version_id      → points to the new promotion version
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
    'rollback',
    'promotion'
  ));

-- ─── 2. promote_generated_note ────────────────────────────────────────────────
--
-- Parameters:
--   p_note_id   — UUID of the note to promote
--   p_actor_id  — UUID of the user performing the promotion
--
-- Returns JSONB row of the updated note.
--
-- Hard failures (RAISE EXCEPTION):
--   'Note not found'         — note does not exist
--   'Note is trashed'        — cannot promote a trashed note
--   'Note is not generated'  — note.is_generated is already false
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promote_generated_note(
  p_note_id   uuid,
  p_actor_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_note           public.notes%ROWTYPE;
  v_max_version    integer;
  v_new_version_id uuid;
BEGIN
  -- Lock the note row to prevent concurrent promotions.
  SELECT * INTO v_note
  FROM public.notes
  WHERE id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found';
  END IF;

  IF v_note.status = 'trashed' THEN
    RAISE EXCEPTION 'Note is trashed';
  END IF;

  IF NOT v_note.is_generated THEN
    RAISE EXCEPTION 'Note is not generated';
  END IF;

  -- Find the current highest version_number for this note.
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_version
  FROM public.note_versions
  WHERE note_id = p_note_id;

  -- Insert a promotion version. Content is identical to the current note —
  -- promotion is a metadata state change, not a content change.
  INSERT INTO public.note_versions (
    note_id,
    parent_version_id,
    version_number,
    title,
    markdown_content,
    content_bytes,
    actor_type,
    actor_id,
    change_origin,
    diff_summary
  ) VALUES (
    p_note_id,
    v_note.current_version_id,
    v_max_version + 1,
    v_note.title,
    v_note.markdown_content,
    v_note.content_bytes,
    'user',
    p_actor_id,
    'promotion',
    NULL
  )
  RETURNING id INTO v_new_version_id;

  -- Clear is_generated and advance current_version_id.
  UPDATE public.notes
  SET
    is_generated       = false,
    current_version_id = v_new_version_id,
    updated_at         = now()
  WHERE id = p_note_id
  RETURNING * INTO v_note;

  RETURN to_jsonb(v_note);
END;
$$;
