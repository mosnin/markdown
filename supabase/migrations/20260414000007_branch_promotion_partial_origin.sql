-- =============================================================================
-- Cherry-pick / partial promote — new change_sets.origin value
-- =============================================================================
--
-- Feature: branch partial promote (cherry-pick). Users can select a subset of
-- objects on an open branch and promote just those to main, leaving the
-- remaining heads/overlays on the branch for later. The partial-promote change
-- set records a different origin so history + rollback can distinguish it from
-- the all-or-nothing branch_promotion path.
--
-- The CHECK list from 20260412000004_rollback_foundations adds the new value
-- 'branch_promotion_partial' alongside the existing 'branch_promotion'. Every
-- other value is preserved verbatim so previously-written rows keep validating.
--
-- Rollback of a partial-promote change set walks the same restore engine the
-- full-promote path uses; see `branch_rollback_service` for how it locates
-- the promotion change set by origin prefix.
-- =============================================================================

ALTER TABLE public.change_sets
  DROP CONSTRAINT IF EXISTS change_sets_origin_check;

ALTER TABLE public.change_sets
  ADD CONSTRAINT change_sets_origin_check
  CHECK (origin IN (
    'manual_edit',
    'import',
    'proposal_approval',
    'structural_move',
    'lifecycle',
    'rollback',
    'restore',
    'branch_promotion',
    'branch_promotion_partial',
    'system'
  ));
