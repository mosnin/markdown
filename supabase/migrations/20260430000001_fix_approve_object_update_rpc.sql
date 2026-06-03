-- =============================================================================
-- Context Store — fix approve_write_proposal_object_update RPC call
-- Migration: 20260430000001_fix_approve_object_update_rpc.sql
--
-- BUG (CRITICAL): approve_write_proposal_object_update (introduced in
--   20260411000005_trust_extension.sql) calls update_object_and_create_version
--   POSITIONALLY using the ORIGINAL signature
--     (text, uuid, text, text, jsonb, text, text) -> uuid.
--
--   Migration 20260411000006_object_model_rpc_v2.sql DROPPED that signature and
--   replaced the function with a v2 variant that takes NAMED params and returns
--   jsonb { "object": {...}, "version": {...} }:
--
--     update_object_and_create_version(
--       p_object_type    text,
--       p_object_id      uuid,
--       p_source_content text,
--       p_content_bytes  integer DEFAULT NULL,
--       p_description    text    DEFAULT NULL,
--       p_tags           text[]  DEFAULT NULL,
--       p_summary        text    DEFAULT NULL,
--       p_agent_type     text    DEFAULT NULL,
--       p_model_hint     text    DEFAULT NULL,
--       p_system_prompt  text    DEFAULT NULL,
--       p_actor_id       text    DEFAULT 'system',
--       p_change_origin  text    DEFAULT 'human_edit',
--       p_diff_summary   jsonb   DEFAULT NULL,
--       p_actor_type     text    DEFAULT 'user'
--     ) RETURNS jsonb
--
--   The old positional call therefore fails to resolve at runtime (no function
--   matches signature (text, uuid, text, text, jsonb, text, text)), so EVERY
--   approval of a file/skill/agent update proposal throws.
--
-- FIX: CREATE OR REPLACE approve_write_proposal_object_update so it invokes the
--   v2 function with NAMED params and reads the new version id out of the
--   returned jsonb via (... -> 'version' ->> 'id')::uuid. The function's own
--   signature, security model, and { outcome, ... } return contract are
--   unchanged — only the body of step "Apply the change atomically" is fixed.
--
-- This migration does NOT edit 20260411000005 (treated as already-shipped).
-- =============================================================================

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
  v_result       jsonb;
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

  -- Step 4: Apply the change atomically (v2 signature: NAMED params, jsonb return)
  v_result := public.update_object_and_create_version(
    p_object_type    => v_proposal.target_object_type,
    p_object_id      => v_proposal.target_object_id,
    p_source_content => v_proposal.proposed_content,
    p_actor_id       => p_reviewer_id::text,   -- actor_id = approving user
    p_change_origin  => 'proposal_approved',
    p_diff_summary   => NULL,                   -- not computed at SQL level
    p_actor_type     => 'user'
  );

  -- v2 returns jsonb { "object": {...}, "version": {...} }; the new version
  -- row's id is the freshly created object_versions.id.
  v_new_vid := (v_result -> 'version' ->> 'id')::uuid;

  -- Step 5: Mark proposal approved
  UPDATE public.write_proposals
     SET status              = 'approved',
         reviewer_id         = p_reviewer_id,
         reviewed_at         = now(),
         review_note         = p_review_note,
         approved_version_id = v_new_vid,
         updated_at          = now()
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'outcome',    'approved',
    'object_id',  v_proposal.target_object_id,
    'version_id', v_new_vid
  );
END;
$$;
