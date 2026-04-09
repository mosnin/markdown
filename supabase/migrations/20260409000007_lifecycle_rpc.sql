-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: lifecycle RPC functions
--
-- Provides atomic subtree lifecycle transitions for folders and a coherent
-- box archive/unarchive operation. Each function runs as a single PostgreSQL
-- transaction.
--
-- Design rules:
--   - Trashed content is hidden from all normal surfaces and external tools.
--   - Archived content is retained but excluded from default retrieval.
--   - Restore returns content to 'active'.
--   - Subtree operations affect the folder and all descendant folders and notes.
--   - Note versions are never mutated by lifecycle operations.
--   - path_cache is unchanged by lifecycle — identity is preserved.
--
-- Security: SECURITY INVOKER (default). The service layer verifies ownership
-- before calling these functions via the admin client.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── trash_folder_subtree ─────────────────────────────────────────────────────
--
-- Sets the given folder and all descendant folders and notes to status='trashed'.
-- Returns a count of affected folders and notes.
--
-- Parameters:
--   p_folder_id — the root folder to trash
--   p_box_id    — the owning box (guard against cross-box abuse)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trash_folder_subtree(
  p_folder_id  uuid,
  p_box_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder_count integer := 0;
  v_note_count   integer := 0;
BEGIN
  -- Verify root folder belongs to the given box
  IF NOT EXISTS (
    SELECT 1 FROM folders WHERE id = p_folder_id AND box_id = p_box_id
  ) THEN
    RAISE EXCEPTION 'Folder % not found in box %', p_folder_id, p_box_id;
  END IF;

  -- Collect all descendant folder ids (including root) via recursive CTE
  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE folders SET status = 'trashed'
   WHERE id IN (SELECT id FROM subtree)
     AND box_id = p_box_id;

  GET DIAGNOSTICS v_folder_count = ROW_COUNT;

  -- Trash all notes in the subtree folders
  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE notes SET status = 'trashed'
   WHERE folder_id IN (SELECT id FROM subtree)
     AND box_id = p_box_id;

  GET DIAGNOSTICS v_note_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'folder_count', v_folder_count,
    'note_count',   v_note_count
  );
END;
$$;

-- ─── restore_folder_subtree ───────────────────────────────────────────────────
--
-- Restores only the trashed content within the folder subtree back to 'active'.
-- Content that was already archived or active before trash is NOT restored to
-- avoid clobbering its pre-trash state. (V1: restore everything trashed → active.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_folder_subtree(
  p_folder_id  uuid,
  p_box_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder_count integer := 0;
  v_note_count   integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM folders WHERE id = p_folder_id AND box_id = p_box_id
  ) THEN
    RAISE EXCEPTION 'Folder % not found in box %', p_folder_id, p_box_id;
  END IF;

  -- Restore trashed folders (only if they are currently trashed)
  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE folders SET status = 'active'
   WHERE id IN (SELECT id FROM subtree)
     AND box_id = p_box_id
     AND status = 'trashed';

  GET DIAGNOSTICS v_folder_count = ROW_COUNT;

  -- Restore trashed notes in the subtree folders
  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE notes SET status = 'active'
   WHERE folder_id IN (SELECT id FROM subtree)
     AND box_id = p_box_id
     AND status = 'trashed';

  GET DIAGNOSTICS v_note_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'folder_count', v_folder_count,
    'note_count',   v_note_count
  );
END;
$$;

-- ─── archive_folder_subtree ───────────────────────────────────────────────────
--
-- Sets the folder and all active/draft descendant folders and notes to
-- 'archived'. Already-trashed content is not touched.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_folder_subtree(
  p_folder_id  uuid,
  p_box_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder_count integer := 0;
  v_note_count   integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM folders WHERE id = p_folder_id AND box_id = p_box_id
  ) THEN
    RAISE EXCEPTION 'Folder % not found in box %', p_folder_id, p_box_id;
  END IF;

  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE folders SET status = 'archived'
   WHERE id IN (SELECT id FROM subtree)
     AND box_id = p_box_id
     AND status <> 'trashed';

  GET DIAGNOSTICS v_folder_count = ROW_COUNT;

  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE notes SET status = 'archived'
   WHERE folder_id IN (SELECT id FROM subtree)
     AND box_id = p_box_id
     AND status <> 'trashed';

  GET DIAGNOSTICS v_note_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'folder_count', v_folder_count,
    'note_count',   v_note_count
  );
END;
$$;

-- ─── unarchive_folder_subtree ─────────────────────────────────────────────────
--
-- Restores archived folders and notes in the subtree back to 'active'.
-- Trashed content within the subtree is not touched.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unarchive_folder_subtree(
  p_folder_id  uuid,
  p_box_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder_count integer := 0;
  v_note_count   integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM folders WHERE id = p_folder_id AND box_id = p_box_id
  ) THEN
    RAISE EXCEPTION 'Folder % not found in box %', p_folder_id, p_box_id;
  END IF;

  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE folders SET status = 'active'
   WHERE id IN (SELECT id FROM subtree)
     AND box_id = p_box_id
     AND status = 'archived';

  GET DIAGNOSTICS v_folder_count = ROW_COUNT;

  WITH RECURSIVE subtree AS (
    SELECT id FROM folders WHERE id = p_folder_id AND box_id = p_box_id
    UNION ALL
    SELECT f.id FROM folders f
      INNER JOIN subtree s ON f.parent_folder_id = s.id
     WHERE f.box_id = p_box_id
  )
  UPDATE notes SET status = 'active'
   WHERE folder_id IN (SELECT id FROM subtree)
     AND box_id = p_box_id
     AND status = 'archived';

  GET DIAGNOSTICS v_note_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'folder_count', v_folder_count,
    'note_count',   v_note_count
  );
END;
$$;

-- ─── archive_box_contents ─────────────────────────────────────────────────────
--
-- Archives the box itself and all non-trashed folders and notes within it.
-- Used when archiving a box as a whole.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_box_contents(
  p_box_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder_count integer := 0;
  v_note_count   integer := 0;
BEGIN
  -- Archive the box itself
  UPDATE boxes SET status = 'archived'
   WHERE id = p_box_id
     AND status <> 'trashed';

  -- Archive all non-trashed folders
  UPDATE folders SET status = 'archived'
   WHERE box_id = p_box_id
     AND status <> 'trashed';

  GET DIAGNOSTICS v_folder_count = ROW_COUNT;

  -- Archive all non-trashed notes
  UPDATE notes SET status = 'archived'
   WHERE box_id = p_box_id
     AND status <> 'trashed';

  GET DIAGNOSTICS v_note_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'folder_count', v_folder_count,
    'note_count',   v_note_count
  );
END;
$$;

-- ─── unarchive_box_contents ───────────────────────────────────────────────────
--
-- Unarchives the box itself and all archived folders and notes within it.
-- Trashed content within the box is not touched.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unarchive_box_contents(
  p_box_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder_count integer := 0;
  v_note_count   integer := 0;
BEGIN
  -- Unarchive the box itself
  UPDATE boxes SET status = 'active'
   WHERE id = p_box_id
     AND status = 'archived';

  -- Unarchive archived folders
  UPDATE folders SET status = 'active'
   WHERE box_id = p_box_id
     AND status = 'archived';

  GET DIAGNOSTICS v_folder_count = ROW_COUNT;

  -- Unarchive archived notes
  UPDATE notes SET status = 'active'
   WHERE box_id = p_box_id
     AND status = 'archived';

  GET DIAGNOSTICS v_note_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'folder_count', v_folder_count,
    'note_count',   v_note_count
  );
END;
$$;
