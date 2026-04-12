-- =============================================================================
-- Context Store — RLS write gate (viewer/member/admin)
-- Migration: 20260412000005_rls_write_role_gate.sql
--
-- The workspace membership migration (20260412000003) introduced the
-- viewer/member/admin role model and redefined `owns_workspace(wid)` to
-- mean "is a member in any role". That makes SELECT gates do the right
-- thing automatically, but the INSERT / UPDATE / DELETE policies across
-- content-bearing tables still accept any member — which means a viewer
-- with a raw Supabase token could, in principle, write.
--
-- This migration closes that gap by re-pointing the write policies of
-- every content-bearing table at `can_write_workspace(wid)` (true for
-- member / admin / owner; false for viewer). Reads continue to go
-- through `owns_workspace(wid)` so any member can still browse.
--
-- Tables covered: notes, folders, files, skills, agents, boxes,
-- note_links, object_links, box_object_attachments, workspace_objects.
--
-- Tables deliberately NOT covered here:
--   * audit_events — append-only trust log; any member write is fine
--     because it can only INSERT (no UPDATE / DELETE policies exist)
--     and the actor is recorded in the row itself.
--   * note_versions / object_versions — written exclusively through
--     SECURITY DEFINER RPCs. The RPCs themselves enforce role gating
--     via the service layer; adding another RLS filter would break
--     current legitimate writers without closing a real gap.
--   * connections / connection_tokens / connection_box_scopes —
--     these are identity / grant rows; they're already scoped to owner
--     in upstream code paths and aren't part of the viewer-facing
--     surface.
--   * write_proposals — created by connections (which aren't one of
--     viewer / member / admin) and approved through admin-client RPCs.
--     Gating this on `can_write_workspace` would break the proposal
--     intake path.
--   * workspaces — unchanged: workspace row is owner-only at the RLS
--     level, and ownership is an explicit, separate concept from
--     membership.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: replace a write policy so viewers are blocked but any
-- existing member keeps working. Using DROP + CREATE makes the change
-- auditable in the migration diff and avoids surprising edge cases
-- around ALTER POLICY on older Postgres versions.
-- ---------------------------------------------------------------------------

-- notes
DROP POLICY IF EXISTS "notes_workspace_insert" ON public.notes;
CREATE POLICY "notes_workspace_insert"
  ON public.notes FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(
    (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
  ));

DROP POLICY IF EXISTS "notes_workspace_update" ON public.notes;
CREATE POLICY "notes_workspace_update"
  ON public.notes FOR UPDATE TO authenticated
  USING (public.can_write_workspace(
    (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
  ))
  WITH CHECK (public.can_write_workspace(
    (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
  ));

DROP POLICY IF EXISTS "notes_workspace_delete" ON public.notes;
CREATE POLICY "notes_workspace_delete"
  ON public.notes FOR DELETE TO authenticated
  USING (public.can_write_workspace(
    (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
  ));

-- folders
DROP POLICY IF EXISTS "folders_workspace_insert" ON public.folders;
CREATE POLICY "folders_workspace_insert"
  ON public.folders FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "folders_workspace_update" ON public.folders;
CREATE POLICY "folders_workspace_update"
  ON public.folders FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "folders_workspace_delete" ON public.folders;
CREATE POLICY "folders_workspace_delete"
  ON public.folders FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- files
DROP POLICY IF EXISTS "files_workspace_insert" ON public.files;
CREATE POLICY "files_workspace_insert"
  ON public.files FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "files_workspace_update" ON public.files;
CREATE POLICY "files_workspace_update"
  ON public.files FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "files_workspace_delete" ON public.files;
CREATE POLICY "files_workspace_delete"
  ON public.files FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- skills
DROP POLICY IF EXISTS "skills_workspace_insert" ON public.skills;
CREATE POLICY "skills_workspace_insert"
  ON public.skills FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "skills_workspace_update" ON public.skills;
CREATE POLICY "skills_workspace_update"
  ON public.skills FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "skills_workspace_delete" ON public.skills;
CREATE POLICY "skills_workspace_delete"
  ON public.skills FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- agents
DROP POLICY IF EXISTS "agents_workspace_insert" ON public.agents;
CREATE POLICY "agents_workspace_insert"
  ON public.agents FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "agents_workspace_update" ON public.agents;
CREATE POLICY "agents_workspace_update"
  ON public.agents FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "agents_workspace_delete" ON public.agents;
CREATE POLICY "agents_workspace_delete"
  ON public.agents FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- boxes
DROP POLICY IF EXISTS "boxes_workspace_insert" ON public.boxes;
CREATE POLICY "boxes_workspace_insert"
  ON public.boxes FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "boxes_workspace_update" ON public.boxes;
CREATE POLICY "boxes_workspace_update"
  ON public.boxes FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "boxes_workspace_delete" ON public.boxes;
CREATE POLICY "boxes_workspace_delete"
  ON public.boxes FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- note_links
DROP POLICY IF EXISTS "note_links_workspace_insert" ON public.note_links;
CREATE POLICY "note_links_workspace_insert"
  ON public.note_links FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(
    (SELECT b.workspace_id FROM public.boxes b
     JOIN public.notes n ON n.box_id = b.id
     WHERE n.id = source_note_id)
  ));

DROP POLICY IF EXISTS "note_links_workspace_delete" ON public.note_links;
CREATE POLICY "note_links_workspace_delete"
  ON public.note_links FOR DELETE TO authenticated
  USING (public.can_write_workspace(
    (SELECT b.workspace_id FROM public.boxes b
     JOIN public.notes n ON n.box_id = b.id
     WHERE n.id = source_note_id)
  ));

-- object_links
DROP POLICY IF EXISTS "object_links_workspace_insert" ON public.object_links;
CREATE POLICY "object_links_workspace_insert"
  ON public.object_links FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "object_links_workspace_delete" ON public.object_links;
CREATE POLICY "object_links_workspace_delete"
  ON public.object_links FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- box_object_attachments
DROP POLICY IF EXISTS "box_object_attachments_workspace_insert" ON public.box_object_attachments;
CREATE POLICY "box_object_attachments_workspace_insert"
  ON public.box_object_attachments FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "box_object_attachments_workspace_delete" ON public.box_object_attachments;
CREATE POLICY "box_object_attachments_workspace_delete"
  ON public.box_object_attachments FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- workspace_objects
DROP POLICY IF EXISTS "workspace_objects_workspace_insert" ON public.workspace_objects;
CREATE POLICY "workspace_objects_workspace_insert"
  ON public.workspace_objects FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "workspace_objects_workspace_update" ON public.workspace_objects;
CREATE POLICY "workspace_objects_workspace_update"
  ON public.workspace_objects FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "workspace_objects_workspace_delete" ON public.workspace_objects;
CREATE POLICY "workspace_objects_workspace_delete"
  ON public.workspace_objects FOR DELETE TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- change_sets, change_set_items, structural_events, restore_records
-- These are created in the previous rollback migration as member-gated
-- via owns_workspace. Tighten to can_write_workspace for the write ops;
-- a restore is a write operation and viewers must not trigger one.
DROP POLICY IF EXISTS "change_sets_workspace_insert" ON public.change_sets;
CREATE POLICY "change_sets_workspace_insert"
  ON public.change_sets FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "change_sets_workspace_update" ON public.change_sets;
CREATE POLICY "change_sets_workspace_update"
  ON public.change_sets FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "change_set_items_workspace_insert" ON public.change_set_items;
CREATE POLICY "change_set_items_workspace_insert"
  ON public.change_set_items FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "structural_events_workspace_insert" ON public.structural_events;
CREATE POLICY "structural_events_workspace_insert"
  ON public.structural_events FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "restore_records_workspace_insert" ON public.restore_records;
CREATE POLICY "restore_records_workspace_insert"
  ON public.restore_records FOR INSERT TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "restore_records_workspace_update" ON public.restore_records;
CREATE POLICY "restore_records_workspace_update"
  ON public.restore_records FOR UPDATE TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));
