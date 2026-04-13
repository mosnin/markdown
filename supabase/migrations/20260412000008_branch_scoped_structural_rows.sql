-- =============================================================================
-- Context Store — branch-scoped structural rows for files and object_links
-- Migration: 20260412000008_branch_scoped_structural_rows.sql
--
-- Previous branch work made content branch-aware: versions land on
-- `branch_heads`, metadata on `branch_package_metadata`. But *creating*
-- a new child file or attaching a Skill to an Agent while on a branch
-- still wrote directly to the canonical `files` / `object_links` rows,
-- leaking draft structure into main.
--
-- This migration closes that gap by adding a nullable `branch_id`
-- column to both tables. A row with `branch_id IS NULL` is main; a
-- row with `branch_id = <uuid>` is draft state that belongs only to
-- that branch. Reads filter on branch context. Promote clears the
-- column (drops the row onto main). Discard hard-deletes the rows
-- (they never reached main; there is no prior state to restore).
--
-- Design trade-offs:
--
--   * Nullable FK to `draft_branches(id) ON DELETE SET NULL` means a
--     deleted branch stops owning its draft rows gracefully — they
--     become main rows rather than orphans. Operators who want a
--     strict drop should delete via the app's discard flow which
--     explicitly hard-deletes the rows before the branch row goes.
--   * The existing `files_box_path_cache_active_uidx` partial unique
--     index is replaced with one that includes `COALESCE(branch_id,
--     '00000000-0000-0000-0000-000000000000'::uuid)` so a draft-branch
--     file and a main file can both exist with the same path_cache
--     without colliding. The zero UUID is a sentinel for "main".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. files.branch_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.files
  ADD COLUMN branch_id uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL;

CREATE INDEX files_branch_id_idx
  ON public.files (branch_id)
  WHERE branch_id IS NOT NULL;

-- Rebuild the box/path uniqueness to be branch-aware. The original
-- index:
--
--   CREATE UNIQUE INDEX files_box_path_cache_active_uidx
--     ON public.files (box_id, path_cache)
--     WHERE status <> 'trashed' AND box_id IS NOT NULL;
--
-- becomes:
DROP INDEX IF EXISTS public.files_box_path_cache_active_uidx;

CREATE UNIQUE INDEX files_box_path_cache_active_uidx
  ON public.files (
    box_id,
    path_cache,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status <> 'trashed' AND box_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. object_links.branch_id
--
--    Agent → Skill references (and any other cross-type links) are
--    written here. Adding branch_id lets a branch record a pending
--    link without touching main.
--
--    No unique-index change needed; object_links' uniqueness is
--    already scoped tightly enough via (source, target,
--    relationship_type) that a branch-only variant is semantically
--    distinct when joined with the active-branch filter in the
--    service layer. A draft and a main link that happen to carry
--    identical (source, target, relationship_type) tuples are an
--    edge case — the service layer short-circuits the draft write
--    when a matching main row already exists (see
--    attach_on_branch).
-- ---------------------------------------------------------------------------

ALTER TABLE public.object_links
  ADD COLUMN branch_id uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL;

CREATE INDEX object_links_branch_id_idx
  ON public.object_links (branch_id)
  WHERE branch_id IS NOT NULL;
