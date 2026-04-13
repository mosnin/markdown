-- =============================================================================
-- Context Store — branch-scoped pending structural operations
-- Migration: 20260412000010_branch_pending_ops.sql
--
-- `branch_id` columns (20260412000008, 20260412000009) gave branches
-- the ability to *create* new rows without leaking to main. They
-- don't cover the inverse: saying "this main row should be trashed /
-- archived / moved / detached when the branch is promoted" without
-- mutating main today.
--
-- This migration adds `branch_pending_ops` — a table of pending
-- structural intents. Each row names an op_type, a target object,
-- and an optional jsonb payload. Reads overlay the intent
-- (trashed / archived rows disappear; moved rows show the new
-- placement). Promote applies each op to the canonical row;
-- discard hard-deletes the ops and leaves main untouched.
--
-- Unified with the existing branch_id model:
--
--   * `branch_id = <uuid>` on a table row means the row EXISTS only
--     on that branch. Hard-deleted on discard; branch_id cleared on
--     promote.
--   * `branch_pending_ops { branch_id, op_type, object_type,
--     object_id, payload }` means "this main row has a pending
--     intent on this branch". Hard-deleted on discard; applied on
--     promote.
--
-- Together these cover every structural branch operation: create,
-- trash, archive, unarchive, move, detach.
-- =============================================================================

CREATE TABLE public.branch_pending_ops (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid        NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,

  -- op_type is deliberately a small enum. Extending it requires a
  -- new applier in pending_op_service; keeping it closed prevents
  -- the table becoming a generic event log.
  op_type       text        NOT NULL
                            CHECK (op_type IN ('trash', 'archive', 'unarchive', 'move', 'detach')),

  -- Polymorphic target. The service layer validates that the pair
  -- points at a real row (files, notes, folders, skills, agents,
  -- object_links) before recording.
  object_type   text        NOT NULL
                            CHECK (object_type IN (
                              'note', 'file', 'folder', 'skill', 'agent',
                              'object_link', 'box_object_attachment'
                            )),
  object_id     uuid        NOT NULL,

  -- payload carries op-specific fields:
  --   move:    { box_id, folder_id, sort_order, path_cache }
  --   detach:  { from_box_id | from_agent_id | ... }
  --   trash / archive / unarchive: null (status change only)
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- actor_id captures who recorded the intent. Distinct from the
  -- branch's creator because multiple write-capable members may
  -- collaborate on one branch.
  actor_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Applied on promote (or a future targeted apply). Null while
  -- pending; timestamp stamped when the op has been applied to the
  -- canonical row.
  applied_at    timestamptz,

  -- One pending op per (branch, op, target) to stop
  -- double-recording. If a user trashes a note on a branch twice,
  -- the second call is a no-op. Changing the op type (e.g.
  -- trash → unarchive) overwrites via the service upsert contract.
  UNIQUE (branch_id, op_type, object_type, object_id)
);

CREATE INDEX branch_pending_ops_branch_idx
  ON public.branch_pending_ops (branch_id)
  WHERE applied_at IS NULL;

-- Target lookup is hot on every branch-aware read — the filter is
-- "is this main row hidden by a pending trash/archive op on the
-- active branch". The partial index keeps the lookup cheap.
CREATE INDEX branch_pending_ops_target_idx
  ON public.branch_pending_ops (object_type, object_id)
  WHERE applied_at IS NULL;

ALTER TABLE public.branch_pending_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY branch_pending_ops_access
  ON public.branch_pending_ops
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_pending_ops.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_pending_ops.branch_id
        AND public.can_write_workspace(b.workspace_id)
    )
  );
