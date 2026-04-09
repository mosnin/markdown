-- =============================================================================
-- Context Store — machine write RPC functions
-- Migration: 20260409000005_machine_write_rpc.sql
--
-- Adds proposed_summary and proposed_tags to write_proposals.
-- Creates atomic SQL functions for:
--   1. approve_write_proposal_update  — update_note / append_note / replace_note
--   2. approve_write_proposal_create  — create_note
--   3. create_generated_note_with_version — direct machine note creation
--
-- All three functions are called via the admin (service-role) client, which
-- already bypasses RLS. They use SECURITY INVOKER (default). The service
-- layer enforces workspace / box / folder / permission-mode checks before
-- calling these functions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend write_proposals with metadata fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.write_proposals
  ADD COLUMN proposed_summary  text,
  ADD COLUMN proposed_tags     text[];

-- ---------------------------------------------------------------------------
-- 2. approve_write_proposal_update
--
-- Atomically approves a pending update_note, append_note, or replace_note
-- proposal.
--
-- Steps:
--   1. Lock proposal row FOR UPDATE (prevents double-approval races).
--   2. Lock target note row FOR UPDATE.
--   3. Check note.current_version_id == proposal.target_version_id.
--      Mismatch → mark proposal 'conflicted', return conflict outcome.
--   4. Compute final title / content / summary / tags.
--      append_note: existing_content + '\n\n' + proposed_content.
--      update_note / replace_note: use proposed values directly.
--   5. Insert new note_version (change_origin = 'proposal_approved').
--   6. Update note fields and current_version_id.
--   7. Mark proposal 'approved'; set approved_version_id.
--
-- Returns jsonb:
--   { outcome: 'approved', note: {...}, version: {...} }
--   { outcome: 'conflicted', reason: '...' }
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_write_proposal_update(
  p_proposal_id  uuid,
  p_reviewer_id  uuid,
  p_review_note  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_proposal  write_proposals;
  v_note      notes;
  v_version   note_versions;
  v_next_num  integer;
  v_bytes     integer;
  v_title     text;
  v_content   text;
  v_summary   text;
  v_tags      text[];
BEGIN
  -- Step 1: Lock proposal
  SELECT * INTO v_proposal
  FROM write_proposals
  WHERE id = p_proposal_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal % not found or not pending', p_proposal_id;
  END IF;

  IF v_proposal.proposal_type NOT IN ('update_note', 'append_note', 'replace_note') THEN
    RAISE EXCEPTION 'approve_write_proposal_update only handles update_note, append_note, replace_note';
  END IF;

  IF v_proposal.target_note_id IS NULL THEN
    RAISE EXCEPTION 'Proposal has no target_note_id';
  END IF;

  -- Step 2: Lock target note
  SELECT * INTO v_note
  FROM notes
  WHERE id = v_proposal.target_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE write_proposals
    SET status      = 'conflicted',
        reviewer_id = p_reviewer_id,
        reviewed_at = now(),
        review_note = p_review_note
    WHERE id = p_proposal_id;

    RETURN jsonb_build_object(
      'outcome', 'conflicted',
      'reason',  'Target note no longer exists'
    );
  END IF;

  -- Step 3: Version check
  IF v_note.current_version_id IS DISTINCT FROM v_proposal.target_version_id THEN
    UPDATE write_proposals
    SET status      = 'conflicted',
        reviewer_id = p_reviewer_id,
        reviewed_at = now(),
        review_note = p_review_note
    WHERE id = p_proposal_id;

    RETURN jsonb_build_object(
      'outcome', 'conflicted',
      'reason',  'Note was modified after the proposal was created'
    );
  END IF;

  -- Step 4: Compute final values
  v_title   := COALESCE(v_proposal.proposed_title,   v_note.title);
  v_summary := COALESCE(v_proposal.proposed_summary, v_note.summary);
  v_tags    := COALESCE(v_proposal.proposed_tags,    v_note.tags);

  IF v_proposal.proposal_type = 'append_note' THEN
    v_content := v_note.markdown_content
                   || E'\n\n'
                   || COALESCE(v_proposal.proposed_content, '');
  ELSE
    -- update_note or replace_note
    v_content := COALESCE(v_proposal.proposed_content, v_note.markdown_content);
  END IF;

  v_bytes := octet_length(v_content);

  -- Step 5: Next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_num
    FROM note_versions
   WHERE note_id = v_note.id;

  -- Step 6: Insert new version
  INSERT INTO note_versions (
    note_id, parent_version_id, version_number,
    title, markdown_content, content_bytes,
    actor_type, actor_id, change_origin
  ) VALUES (
    v_note.id,
    v_note.current_version_id,
    v_next_num,
    v_title,
    v_content,
    v_bytes,
    'user',
    p_reviewer_id::text,
    'proposal_approved'
  )
  RETURNING * INTO v_version;

  -- Step 7: Update note
  UPDATE notes SET
    title              = v_title,
    markdown_content   = v_content,
    content_bytes      = v_bytes,
    summary            = v_summary,
    tags               = v_tags,
    current_version_id = v_version.id
  WHERE id = v_note.id
  RETURNING * INTO v_note;

  -- Step 8: Mark proposal approved
  UPDATE write_proposals SET
    status              = 'approved',
    reviewer_id         = p_reviewer_id,
    reviewed_at         = now(),
    review_note         = p_review_note,
    approved_version_id = v_version.id
  WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'outcome', 'approved',
    'note',    to_jsonb(v_note),
    'version', to_jsonb(v_version)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. approve_write_proposal_create
--
-- Atomically approves a pending create_note proposal.
-- Slug and path_cache are pre-computed and deduplicated by the service layer.
--
-- Steps:
--   1. Lock proposal row FOR UPDATE.
--   2. Verify proposed_folder_id still exists (conflict if gone).
--   3. Insert note (origin_type='generated', is_generated=true,
--        generated_by_connection_id=proposal.connection_id).
--   4. Insert initial note_version (change_origin='proposal_approved',
--        actor_type='user', actor_id=reviewer_id).
--   5. Link note to its initial version.
--   6. Mark proposal 'approved'; set approved_note_id, approved_version_id.
--
-- Returns jsonb:
--   { outcome: 'approved', note: {...}, version: {...} }
--   { outcome: 'conflicted', reason: '...' }
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_write_proposal_create(
  p_proposal_id  uuid,
  p_reviewer_id  uuid,
  p_slug         text,
  p_path_cache   text,
  p_review_note  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_proposal  write_proposals;
  v_folder    folders;
  v_note      notes;
  v_version   note_versions;
  v_bytes     integer;
  v_title     text;
  v_content   text;
BEGIN
  -- Step 1: Lock proposal
  SELECT * INTO v_proposal
  FROM write_proposals
  WHERE id = p_proposal_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal % not found or not pending', p_proposal_id;
  END IF;

  IF v_proposal.proposal_type != 'create_note' THEN
    RAISE EXCEPTION 'approve_write_proposal_create only handles create_note proposals';
  END IF;

  IF v_proposal.proposed_folder_id IS NULL THEN
    RAISE EXCEPTION 'create_note proposal must have a proposed_folder_id';
  END IF;

  -- Step 2: Verify folder still exists
  SELECT * INTO v_folder FROM folders WHERE id = v_proposal.proposed_folder_id;

  IF NOT FOUND THEN
    UPDATE write_proposals
    SET status      = 'conflicted',
        reviewer_id = p_reviewer_id,
        reviewed_at = now(),
        review_note = p_review_note
    WHERE id = p_proposal_id;

    RETURN jsonb_build_object(
      'outcome', 'conflicted',
      'reason',  'Target folder no longer exists'
    );
  END IF;

  v_title   := COALESCE(v_proposal.proposed_title,   'Untitled');
  v_content := COALESCE(v_proposal.proposed_content, '');
  v_bytes   := octet_length(v_content);

  -- Step 3: Insert note
  INSERT INTO notes (
    box_id, folder_id, title, slug, path_cache,
    markdown_content, content_bytes,
    summary, tags, kind, status,
    origin_type, is_generated, generated_by_connection_id
  ) VALUES (
    v_folder.box_id,
    v_proposal.proposed_folder_id,
    v_title,
    p_slug,
    p_path_cache,
    v_content,
    v_bytes,
    v_proposal.proposed_summary,
    COALESCE(v_proposal.proposed_tags, '{}'),
    'note',
    'active',
    'generated',
    true,
    v_proposal.connection_id
  )
  RETURNING * INTO v_note;

  -- Step 4: Insert initial version
  INSERT INTO note_versions (
    note_id, parent_version_id, version_number,
    title, markdown_content, content_bytes,
    actor_type, actor_id, change_origin
  ) VALUES (
    v_note.id,
    NULL,
    1,
    v_title,
    v_content,
    v_bytes,
    'user',
    p_reviewer_id::text,
    'proposal_approved'
  )
  RETURNING * INTO v_version;

  -- Step 5: Link note to version
  UPDATE notes SET current_version_id = v_version.id
  WHERE id = v_note.id
  RETURNING * INTO v_note;

  -- Step 6: Mark proposal approved
  UPDATE write_proposals SET
    status              = 'approved',
    reviewer_id         = p_reviewer_id,
    reviewed_at         = now(),
    review_note         = p_review_note,
    approved_note_id    = v_note.id,
    approved_version_id = v_version.id
  WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'outcome', 'approved',
    'note',    to_jsonb(v_note),
    'version', to_jsonb(v_version)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_generated_note_with_version
--
-- Atomically creates a machine-authored note in a specific folder.
-- Called by generate_in_allowed_folders connections for direct note creation.
--
-- The service layer verifies:
--   - connection.permission_mode = 'generate_in_allowed_folders'
--   - folder.accepts_generated_notes = true
--   - folder.box_id ∈ connection.allowed_box_ids
--
-- Origin tracking:
--   - note.origin_type             = 'generated'
--   - note.is_generated            = true
--   - note.generated_by_connection_id = p_connection_id
--   - note_version.actor_type      = 'connection'
--   - note_version.actor_id        = p_connection_id
--   - note_version.change_origin   = 'generated'
--
-- Returns jsonb: { note: {...}, version: {...} }
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_generated_note_with_version(
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
  p_connection_id       uuid
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

  -- Insert the note
  INSERT INTO notes (
    box_id, folder_id, title, slug, path_cache,
    markdown_content, content_bytes,
    summary, tags, read_hint, retrieval_priority, kind,
    status, origin_type, is_generated, generated_by_connection_id
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
    'note',
    'active',
    'generated',
    true,
    p_connection_id
  )
  RETURNING * INTO v_note;

  -- Insert initial version
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
    'connection',
    p_connection_id::text,
    'generated'
  )
  RETURNING * INTO v_version;

  -- Link note to initial version
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
