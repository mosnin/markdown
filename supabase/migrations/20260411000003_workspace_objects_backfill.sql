-- =============================================================================
-- Context Store — object model expansion: workspace_objects backfill
-- Migration: 20260411000003_workspace_objects_backfill.sql
--
-- One-time data migration. Populates workspace_objects for every existing
-- folder and note so that the registry is consistent from the moment the
-- object model tables go live.
--
-- Going forward, workspace_objects is maintained exclusively by the service
-- layer: every create / rename / move / trash operation on a note or folder
-- must write a corresponding workspace_objects row. This migration must not
-- be re-run — ON CONFLICT DO NOTHING makes it safe to re-execute, but the
-- intent is a single forward migration only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Backfill folders
--
--    Joins folders → boxes to derive workspace_id.
--    folder_id in workspace_objects holds the parent_folder_id (i.e. the
--    folder the registered object lives *inside*), mirroring the convention
--    used by notes.  For a folder row itself the "parent container" is its
--    parent_folder_id.
-- ---------------------------------------------------------------------------

INSERT INTO public.workspace_objects (
  workspace_id,
  box_id,
  folder_id,
  object_type,
  object_id,
  display_name,
  status,
  is_reusable
)
SELECT
  b.workspace_id,
  f.box_id,
  f.parent_folder_id,
  'folder',
  f.id,
  f.name,
  f.status,
  false
FROM public.folders f
JOIN public.boxes b ON b.id = f.box_id
ON CONFLICT (object_type, object_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Backfill notes
--
--    Joins notes → boxes to derive workspace_id.
--    Uses the note's own folder_id as the containing folder.
-- ---------------------------------------------------------------------------

INSERT INTO public.workspace_objects (
  workspace_id,
  box_id,
  folder_id,
  object_type,
  object_id,
  display_name,
  status,
  is_reusable
)
SELECT
  b.workspace_id,
  n.box_id,
  n.folder_id,
  'note',
  n.id,
  n.title,
  n.status,
  false
FROM public.notes n
JOIN public.boxes b ON b.id = n.box_id
ON CONFLICT (object_type, object_id) DO NOTHING;
