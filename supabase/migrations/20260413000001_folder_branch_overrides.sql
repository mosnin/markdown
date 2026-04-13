-- =============================================================================
-- Context Store — folder-branch overrides overlay
-- Migration: 20260413000001_folder_branch_overrides.sql
--
-- Folders already carry a `branch_id` column so branch-local folder
-- *creation* works. What was missing: *edits* to existing main folders
-- (rename / reparent / reorder) still mutated the canonical row
-- directly, which violates the "branches must not silently mutate
-- main" trust rule.
--
-- This migration mirrors `branch_package_metadata` for folders: a
-- thin overlay table that records per-(branch, folder) field
-- overrides. Reads overlay the fields on top of the canonical folder
-- row; `promoteFolderOverrides` applies the overlay to the canonical
-- row on promote; discard drops overrides with no effect on main.
--
-- Design:
--
--   * One row per (branch_id, folder_id). Upserted on every folder
--     edit on a branch; no history per override (the row is
--     immutable from the branch's perspective — the branch is either
--     promoted or discarded).
--   * Every overlay field is nullable; NULL means "no override for
--     this field", inherit from main. This keeps overlays small and
--     lets rename-only or reparent-only drafts avoid touching every
--     column.
--   * `parent_folder_id` does not have an FK — the branch can set it
--     to null (root) without the targeted folder being deleted; a
--     target folder that disappears between override and promote
--     surfaces as a promote-time error rather than a constraint
--     violation on insert.
-- =============================================================================

CREATE TABLE public.folder_branch_overrides (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid        NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,
  folder_id         uuid        NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,

  -- Override fields. NULL = "no override for this field".
  name              text,
  parent_folder_id  uuid,
  sort_order        int,
  path_cache        text,

  actor_id          uuid        REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (branch_id, folder_id)
);

CREATE INDEX folder_branch_overrides_branch_idx
  ON public.folder_branch_overrides (branch_id);
CREATE INDEX folder_branch_overrides_folder_idx
  ON public.folder_branch_overrides (folder_id);

CREATE TRIGGER folder_branch_overrides_set_updated_at
  BEFORE UPDATE ON public.folder_branch_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.folder_branch_overrides ENABLE ROW LEVEL SECURITY;

-- Access rules mirror branch_package_metadata: workspace members
-- can read overlays on their workspace's branches; writes gated via
-- can_write_workspace / owns_workspace resolved through the branch's
-- workspace_id.

CREATE POLICY folder_branch_overrides_access
  ON public.folder_branch_overrides
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = folder_branch_overrides.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = folder_branch_overrides.branch_id
        AND public.can_write_workspace(b.workspace_id)
    )
  );
