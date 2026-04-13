-- =============================================================================
-- Context Store — branch-scoped rows for notes, folders, and boxes
-- Migration: 20260412000009_branch_scoped_content_rows.sql
--
-- Extends the branch_id ownership column added in
-- 20260412000008 (files + object_links) to the three remaining
-- creatable object types: notes, folders, and boxes. Same shape:
-- a nullable FK to draft_branches, ON DELETE SET NULL, with the
-- respective partial unique indexes rebuilt so a branch row and a
-- main row can share the same (box, path_cache) or (workspace, slug)
-- without colliding.
--
-- Design notes reprised from the files migration:
--
--   * Nullable FK → a deleted branch drops ownership gracefully;
--     the app's discard flow explicitly hard-deletes branch rows
--     before the branch row is marked discarded so this fallback
--     is just defence in depth.
--   * `COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)`
--     makes the unique index branch-aware — a draft and a main row
--     can coexist at the same path.
--   * `branch_id` is intentionally absent from folder `parent_folder_id`
--     + `notes.folder_id` FK checks. A note or folder can sit inside
--     a main-created parent folder on a branch; the parent's identity
--     is branch-independent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. notes.branch_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.notes
  ADD COLUMN branch_id uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL;

CREATE INDEX notes_branch_id_idx
  ON public.notes (branch_id)
  WHERE branch_id IS NOT NULL;

DROP INDEX IF EXISTS public.notes_box_path_cache_active_uidx;

CREATE UNIQUE INDEX notes_box_path_cache_active_uidx
  ON public.notes (
    box_id,
    path_cache,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status <> 'trashed';

-- ---------------------------------------------------------------------------
-- 2. folders.branch_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.folders
  ADD COLUMN branch_id uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL;

CREATE INDEX folders_branch_id_idx
  ON public.folders (branch_id)
  WHERE branch_id IS NOT NULL;

DROP INDEX IF EXISTS public.folders_box_path_cache_active_uidx;

CREATE UNIQUE INDEX folders_box_path_cache_active_uidx
  ON public.folders (
    box_id,
    path_cache,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status <> 'trashed';

-- ---------------------------------------------------------------------------
-- 3. boxes.branch_id
--
--    Box uniqueness is by (workspace_id, slug), not box + path. The
--    rebuild follows the same pattern.
-- ---------------------------------------------------------------------------

ALTER TABLE public.boxes
  ADD COLUMN branch_id uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL;

CREATE INDEX boxes_branch_id_idx
  ON public.boxes (branch_id)
  WHERE branch_id IS NOT NULL;

DROP INDEX IF EXISTS public.boxes_workspace_slug_active_uidx;

CREATE UNIQUE INDEX boxes_workspace_slug_active_uidx
  ON public.boxes (
    workspace_id,
    slug,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status <> 'trashed';
