-- =============================================================================
-- Context Store — vocabulary normalization
-- Migration: 20260409000009_vocabulary_normalization.sql
--
-- Corrects enum drift in five areas:
--
--   1. notes.origin_type
--        'human'     → 'user_created'
--        'generated' → 'generated_by_tool'
--      New 5-value CHECK: user_created, imported, generated_by_tool,
--                         duplicated, restored
--
--   2. notes.read_hint
--      Previously unconstrained free text. Now enforced as one of 6 canonical
--      values (or NULL).
--      Non-conforming existing values are NULLed before the constraint is added.
--
--   3. connections.connection_type
--        'api'     → 'api_token'
--        'webhook' → 'internal'
--      New 3-value CHECK: mcp, api_token, internal
--
--   4. connections.status
--        'suspended' → 'paused'
--      New 3-value CHECK: active, paused, revoked
--
--   5. RPC function updates
--      create_note_with_initial_version — accepts p_origin_type and p_change_origin
--      approve_write_proposal_create    — uses origin_type='generated_by_tool'
--      create_generated_note_with_version — uses origin_type='generated_by_tool'
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. notes.origin_type — data migration then constraint replacement
-- ---------------------------------------------------------------------------

UPDATE public.notes SET origin_type = 'user_created'      WHERE origin_type = 'human';
UPDATE public.notes SET origin_type = 'generated_by_tool' WHERE origin_type = 'generated';

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_origin_type_check;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_origin_type_check
  CHECK (origin_type IN (
    'user_created',
    'imported',
    'generated_by_tool',
    'duplicated',
    'restored'
  ));

-- Update the column default to match the new vocabulary
ALTER TABLE public.notes
  ALTER COLUMN origin_type SET DEFAULT 'user_created';

-- ---------------------------------------------------------------------------
-- 2. notes.read_hint — null out non-conforming values, then add CHECK
-- ---------------------------------------------------------------------------

UPDATE public.notes
SET read_hint = NULL
WHERE read_hint IS NOT NULL
  AND read_hint NOT IN (
    'read_first',
    'core_reference',
    'supporting_context',
    'related',
    'archive_only',
    'generated'
  );

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_read_hint_check;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_read_hint_check
  CHECK (
    read_hint IS NULL
    OR read_hint IN (
      'read_first',
      'core_reference',
      'supporting_context',
      'related',
      'archive_only',
      'generated'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. connections.connection_type — data migration then constraint replacement
-- ---------------------------------------------------------------------------

UPDATE public.connections SET connection_type = 'api_token' WHERE connection_type = 'api';
UPDATE public.connections SET connection_type = 'internal'  WHERE connection_type = 'webhook';

ALTER TABLE public.connections
  DROP CONSTRAINT IF EXISTS connections_connection_type_check;

ALTER TABLE public.connections
  ADD CONSTRAINT connections_connection_type_check
  CHECK (connection_type IN ('mcp', 'api_token', 'internal'));

-- ---------------------------------------------------------------------------
-- 4. connections.status — data migration then constraint replacement
-- ---------------------------------------------------------------------------

UPDATE public.connections SET status = 'paused' WHERE status = 'suspended';

ALTER TABLE public.connections
  DROP CONSTRAINT IF EXISTS connections_status_check;

ALTER TABLE public.connections
  ADD CONSTRAINT connections_status_check
  CHECK (status IN ('active', 'paused', 'revoked'));

-- ---------------------------------------------------------------------------
-- 5a. create_note_with_initial_version — add p_origin_type and p_change_origin
--
-- Import flows pass p_origin_type='imported' and p_change_origin='import'.
-- Human note creation omits both and receives the defaults (user_created / human_edit).
-- ---------------------------------------------------------------------------

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
  p_actor_id            text,
  p_origin_type         text     DEFAULT 'user_created',
  p_change_origin       text     DEFAULT 'human_edit'
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
    p_origin_type,
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
    p_change_origin
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

-- ---------------------------------------------------------------------------
-- 5b. approve_write_proposal_create — use origin_type='generated_by_tool'
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
    'generated_by_tool',
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
-- 5c. create_generated_note_with_version — use origin_type='generated_by_tool'
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
    'generated_by_tool',
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
