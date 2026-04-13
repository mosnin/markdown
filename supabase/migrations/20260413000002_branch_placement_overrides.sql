-- =============================================================================
-- Context Store — branch-local placement overrides overlay
-- Migration: 20260413000002_branch_placement_overrides.sql
--
-- Drag-and-drop reorder and cross-folder move still wrote directly
-- to `workspace_objects.sort_order` (and `notes.folder_id` /
-- `files.folder_id` / `workspace_objects.folder_id` /
-- `box_object_attachments.folder_id`) regardless of whether a
-- branch was active. That was the last main-mutating leak in
-- branch mode.
--
-- This migration mirrors `folder_branch_overrides` for tree
-- placement: a thin overlay table that records per-(branch,
-- target) sort_order + folder_id intent for any draggable tree
-- entry. Reads overlay the fields on top of the canonical row;
-- `promotePlacementOverrides` writes the overlay back to main on
-- promote; discard drops the overlay with no effect on main.
--
-- Design:
--
--   * One row per (branch_id, target_type, target_id). Targets are
--     either `workspace_object` rows (native note/file/folder/skill/
--     agent placement) or `box_object_attachment` rows (reusable
--     skill/agent attached into a box). Upserted on every
--     reorder/move; no history per override — branches are promoted
--     or discarded atomically.
--   * `sort_order` is nullable — NULL means "no sort override for
--     this target" (it might only have a folder override).
--   * `folder_id` is nullable AND has a companion
--     `folder_id_overridden` flag because NULL is a valid explicit
--     target for "moved to root on this branch". The flag
--     distinguishes "no override" from "override to root".
-- =============================================================================

CREATE TABLE public.branch_placement_overrides (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id            uuid        NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,

  -- Which overlay shape the row addresses. `workspace_object`
  -- rows hold native placement (folder_id + sort_order on the
  -- workspace_objects index); `box_object_attachment` rows hold
  -- per-box placement for reusable skills/agents attached into
  -- a box.
  target_type          text        NOT NULL
                                   CHECK (target_type IN (
                                     'workspace_object',
                                     'box_object_attachment'
                                   )),
  target_id            uuid        NOT NULL,

  -- Canonical object pointer for diff display + promote. For
  -- workspace_object rows this duplicates the workspace_objects
  -- (object_type, object_id) columns; for attachment rows it
  -- duplicates the attachment's (object_type, object_id). Stored
  -- here so promote and diff don't have to re-join the canonical
  -- row when the override is the only record of intent.
  object_type          text,
  object_id            uuid,

  box_id               uuid        NOT NULL REFERENCES public.boxes(id) ON DELETE CASCADE,

  -- Override fields. NULL sort_order = "no sort override". folder_id
  -- is paired with folder_id_overridden because NULL is a legal
  -- override value (move to root on this branch).
  sort_order           bigint,
  folder_id            uuid,
  folder_id_overridden boolean     NOT NULL DEFAULT false,

  actor_id             uuid        REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (branch_id, target_type, target_id)
);

CREATE INDEX branch_placement_overrides_branch_box_idx
  ON public.branch_placement_overrides (branch_id, box_id);
CREATE INDEX branch_placement_overrides_target_idx
  ON public.branch_placement_overrides (target_type, target_id);

CREATE TRIGGER branch_placement_overrides_set_updated_at
  BEFORE UPDATE ON public.branch_placement_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.branch_placement_overrides ENABLE ROW LEVEL SECURITY;

-- Access rules mirror folder_branch_overrides: workspace owners
-- can read/write overlays on their workspace's branches, resolved
-- through the branch's workspace_id.

CREATE POLICY branch_placement_overrides_access
  ON public.branch_placement_overrides
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_placement_overrides.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_placement_overrides.branch_id
        AND public.can_write_workspace(b.workspace_id)
    )
  );
