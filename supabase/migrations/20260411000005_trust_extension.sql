-- =============================================================================
-- Context Store — trust model extension across expanded object system
-- Migration: 20260411000005_trust_extension.sql
--
-- Extends:
--   write_proposals   — add target_object_type / target_object_id /
--                       target_object_version_id for file/skill/agent proposals
--   New proposal type check values
--
-- Creates:
--   approve_write_proposal_object_update  — atomic approval for file/skill/agent
--                                           update proposals (mirrors the existing
--                                           approve_write_proposal_update for notes)
--   rollback_object_to_version            — atomic rollback for files/skills/agents
--                                           (mirrors rollback_note_to_version)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend write_proposals
--
--    Add three nullable columns so proposals can target files, skills, or agents
--    in addition to notes. A proposal targets either a note (target_note_id) or
--    an object (target_object_type + target_object_id) — never both.
--
--    target_object_version_id: object_versions.id captured at submission time,
--      used for conflict detection on approval (mirrors target_version_id for notes).
--
--    Expand the proposal_type check to include object-level types.
-- ---------------------------------------------------------------------------

ALTER TABLE public.write_proposals
  ADD COLUMN IF NOT EXISTS target_object_type    text
    CHECK (target_object_type IN ('file', 'skill', 'agent')),
  ADD COLUMN IF NOT EXISTS target_object_id      uuid,
  ADD COLUMN IF NOT EXISTS target_object_version_id uuid;

-- Drop the old proposal_type check constraint before re-adding with expanded values.
-- (constraint name follows the Postgres default naming convention)
ALTER TABLE public.write_proposals
  DROP CONSTRAINT IF EXISTS write_proposals_proposal_type_check;

ALTER TABLE public.write_proposals
  ADD CONSTRAINT write_proposals_proposal_type_check
  CHECK (proposal_type IN (
    'create_note',  'update_note', 'append_note', 'replace_note',
    'update_file',
    'create_skill', 'update_skill',
    'create_agent', 'update_agent'
  ));

-- Index for quick lookup of proposals targeting a specific object.
CREATE INDEX IF NOT EXISTS write_proposals_object_target_idx
  ON public.write_proposals (target_object_type, target_object_id)
  WHERE target_object_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. approve_write_proposal_object_update
--
--    Atomically approves an update_file / update_skill / update_agent proposal.
--
--    Steps:
--      1. Lock proposal FOR UPDATE
--      2. Verify proposal is PENDING and targets the correct object type
--      3. Lock target object row FOR UPDATE
--      4. Conflict check: target object's current_version_id must equal
--         proposal.target_object_version_id
--      5. If conflicted: mark proposal 'conflicted', return without mutating
--      6. If matched: call update_object_and_create_version to create the new
--         version and advance current_version_id / source_content
--      7. Mark proposal 'approved', set approved_version_id
--
--    Returns: jsonb { outcome: 'approved'|'conflicted', reason?: text,
--                     object_id?: uuid, version_id?: uuid }
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_write_proposal_object_update(
  p_proposal_id  uuid,
  p_reviewer_id  uuid,
  p_review_note  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_proposal     record;
  v_current_vid  uuid;
  v_new_vid      uuid;
BEGIN
  -- Step 1: Lock proposal
  SELECT * INTO v_proposal
    FROM public.write_proposals
   WHERE id = p_proposal_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'reason', 'Proposal not found');
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'error', 'reason',
      'Proposal is not pending: ' || v_proposal.status);
  END IF;

  IF v_proposal.target_object_type IS NULL OR v_proposal.target_object_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'error', 'reason',
      'Proposal does not target a file/skill/agent');
  END IF;

  -- Step 2: Lock and read current_version_id from the owning table
  IF v_proposal.target_object_type = 'file' THEN
    SELECT current_version_id INTO v_current_vid
      FROM public.files
     WHERE id = v_proposal.target_object_id
     FOR UPDATE;
  ELSIF v_proposal.target_object_type = 'skill' THEN
    SELECT current_version_id INTO v_current_vid
      FROM public.skills
     WHERE id = v_proposal.target_object_id
     FOR UPDATE;
  ELSIF v_proposal.target_object_type = 'agent' THEN
    SELECT current_version_id INTO v_current_vid
      FROM public.agents
     WHERE id = v_proposal.target_object_id
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'reason', 'Target object not found');
  END IF;

  -- Step 3: Conflict detection
  IF v_proposal.target_object_version_id IS NOT NULL
     AND v_current_vid IS DISTINCT FROM v_proposal.target_object_version_id THEN
    UPDATE public.write_proposals
       SET status = 'conflicted', updated_at = now()
     WHERE id = p_proposal_id;
    RETURN jsonb_build_object(
      'outcome', 'conflicted',
      'reason',  'Object was modified after proposal was submitted'
    );
  END IF;

  -- Step 4: Apply the change atomically
  SELECT public.update_object_and_create_version(
    v_proposal.target_object_type,
    v_proposal.target_object_id,
    p_reviewer_id::text,        -- actor_id = approving user
    v_proposal.proposed_content,
    NULL,                        -- diff_summary (not computed at SQL level)
    'proposal_approved',
    'user'
  ) INTO v_new_vid;

  -- Step 5: Mark proposal approved
  UPDATE public.write_proposals
     SET status             = 'approved',
         reviewer_id        = p_reviewer_id,
         reviewed_at        = now(),
         review_note        = p_review_note,
         approved_version_id = v_new_vid,
         updated_at         = now()
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'outcome',    'approved',
    'object_id',  v_proposal.target_object_id,
    'version_id', v_new_vid
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. rollback_object_to_version
--
--    Atomically rolls back a file, skill, or agent to a prior version.
--
--    Steps:
--      1. Lock the owning object row FOR UPDATE
--      2. Verify the target version belongs to this object
--      3. Compute next version_number
--      4. Insert a new object_version with:
--           source_content   = target snapshot's source_content
--           change_origin    = 'rollback'
--           actor_type       = 'user'
--           actor_id         = p_actor_id
--           parent_version_id = current version id
--      5. Update the owning table: current_version_id, source_content, content_bytes
--
--    Returns: jsonb { new_version_id: uuid, version_number: int }
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rollback_object_to_version(
  p_object_type      text,
  p_object_id        uuid,
  p_target_version_id uuid,
  p_actor_id         text,
  p_diff_summary     jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current_vid       uuid;
  v_target_content    text;
  v_target_bytes      integer;
  v_next_version_num  integer;
  v_new_vid           uuid;
  v_content_bytes     integer;
BEGIN
  -- Step 1: Lock owning row + read current state
  IF p_object_type = 'file' THEN
    SELECT current_version_id INTO v_current_vid
      FROM public.files WHERE id = p_object_id FOR UPDATE;
  ELSIF p_object_type = 'skill' THEN
    SELECT current_version_id INTO v_current_vid
      FROM public.skills WHERE id = p_object_id FOR UPDATE;
  ELSIF p_object_type = 'agent' THEN
    SELECT current_version_id INTO v_current_vid
      FROM public.agents WHERE id = p_object_id FOR UPDATE;
  ELSE
    RETURN jsonb_build_object('outcome', 'error', 'reason', 'Unknown object_type');
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'reason', 'Object not found');
  END IF;

  -- Step 2: Verify target version belongs to this object
  SELECT source_content, content_bytes
    INTO v_target_content, v_target_bytes
    FROM public.object_versions
   WHERE id          = p_target_version_id
     AND object_type = p_object_type
     AND object_id   = p_object_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'error', 'reason', 'Target version not found');
  END IF;

  -- Step 3: Compute next version_number
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version_num
    FROM public.object_versions
   WHERE object_type = p_object_type
     AND object_id   = p_object_id;

  v_content_bytes := octet_length(v_target_content::bytea);

  -- Step 4: Insert new rollback version
  INSERT INTO public.object_versions (
    object_type, object_id, parent_version_id,
    version_number, source_content, content_bytes,
    actor_type, actor_id, change_origin, diff_summary
  )
  VALUES (
    p_object_type, p_object_id, v_current_vid,
    v_next_version_num, v_target_content, v_content_bytes,
    'user', p_actor_id, 'rollback', p_diff_summary
  )
  RETURNING id INTO v_new_vid;

  -- Step 5: Advance owning table
  IF p_object_type = 'file' THEN
    UPDATE public.files
       SET current_version_id = v_new_vid,
           source_content     = v_target_content,
           content_bytes      = v_content_bytes,
           updated_at         = now()
     WHERE id = p_object_id;
  ELSIF p_object_type = 'skill' THEN
    UPDATE public.skills
       SET current_version_id = v_new_vid,
           source_content     = v_target_content,
           content_bytes      = v_content_bytes,
           updated_at         = now()
     WHERE id = p_object_id;
  ELSIF p_object_type = 'agent' THEN
    UPDATE public.agents
       SET current_version_id = v_new_vid,
           source_content     = v_target_content,
           content_bytes      = v_content_bytes,
           updated_at         = now()
     WHERE id = p_object_id;
  END IF;

  RETURN jsonb_build_object(
    'new_version_id', v_new_vid,
    'version_number', v_next_version_num
  );
END;
$$;
