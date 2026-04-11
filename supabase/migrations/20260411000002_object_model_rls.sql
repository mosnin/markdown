-- =============================================================================
-- Context Store — object model expansion: Row Level Security policies
-- Migration: 20260411000002_object_model_rls.sql
--
-- RLS model (V1 — single owner):
--   All new tables derive access from workspace ownership via
--   public.owns_workspace(workspace_id) or the box → workspace chain.
--   Connection token authorization is NOT handled here — it is enforced
--   by the API/MCP layer. These policies cover human session access only.
--
-- Policy naming convention:
--   <table>_workspace_<operation>  for workspace-scoped tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- workspace_objects
--   The workspace owner manages all object registry entries.
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_objects_workspace_select"
  ON public.workspace_objects FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "workspace_objects_workspace_insert"
  ON public.workspace_objects FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "workspace_objects_workspace_update"
  ON public.workspace_objects FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "workspace_objects_workspace_delete"
  ON public.workspace_objects FOR DELETE
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- files
--   Files may be workspace-level (box_id IS NULL) or box-scoped.
--   Both cases are handled in a single policy expression:
--     workspace-level → owns_workspace(workspace_id)
--     box-scoped      → box → workspace ownership chain
-- ---------------------------------------------------------------------------

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "files_workspace_select"
  ON public.files FOR SELECT
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "files_workspace_insert"
  ON public.files FOR INSERT
  TO authenticated
  WITH CHECK (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "files_workspace_update"
  ON public.files FOR UPDATE
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  )
  WITH CHECK (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "files_workspace_delete"
  ON public.files FOR DELETE
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

-- ---------------------------------------------------------------------------
-- skills
--   Same dual-scope pattern as files: workspace-level or box-scoped.
-- ---------------------------------------------------------------------------

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skills_workspace_select"
  ON public.skills FOR SELECT
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "skills_workspace_insert"
  ON public.skills FOR INSERT
  TO authenticated
  WITH CHECK (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "skills_workspace_update"
  ON public.skills FOR UPDATE
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  )
  WITH CHECK (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "skills_workspace_delete"
  ON public.skills FOR DELETE
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

-- ---------------------------------------------------------------------------
-- agents
--   Same dual-scope pattern as files and skills.
-- ---------------------------------------------------------------------------

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_workspace_select"
  ON public.agents FOR SELECT
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "agents_workspace_insert"
  ON public.agents FOR INSERT
  TO authenticated
  WITH CHECK (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "agents_workspace_update"
  ON public.agents FOR UPDATE
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  )
  WITH CHECK (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

CREATE POLICY "agents_workspace_delete"
  ON public.agents FOR DELETE
  TO authenticated
  USING (
    (box_id IS NULL AND public.owns_workspace(workspace_id))
    OR (box_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    ))
  );

-- ---------------------------------------------------------------------------
-- object_versions
--   Append-only. Owners may SELECT and INSERT. No UPDATE or DELETE.
--   Derives workspace ownership through the owning object's workspace_id
--   stored on files / skills / agents, resolved via a UNION subquery.
-- ---------------------------------------------------------------------------

ALTER TABLE public.object_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "object_versions_workspace_select"
  ON public.object_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.files f
      WHERE f.id = object_id AND object_type = 'file'
        AND public.owns_workspace(f.workspace_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.skills s
      WHERE s.id = object_id AND object_type = 'skill'
        AND public.owns_workspace(s.workspace_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = object_id AND object_type = 'agent'
        AND public.owns_workspace(a.workspace_id)
    )
  );

CREATE POLICY "object_versions_workspace_insert"
  ON public.object_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.files f
      WHERE f.id = object_id AND object_type = 'file'
        AND public.owns_workspace(f.workspace_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.skills s
      WHERE s.id = object_id AND object_type = 'skill'
        AND public.owns_workspace(s.workspace_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = object_id AND object_type = 'agent'
        AND public.owns_workspace(a.workspace_id)
    )
  );

-- No UPDATE policy — object_versions are immutable.
-- No DELETE policy — object_versions are retained.

-- ---------------------------------------------------------------------------
-- object_links
--   Workspace owner manages all links within their workspace.
--   Links are replaced not mutated — no UPDATE policy.
-- ---------------------------------------------------------------------------

ALTER TABLE public.object_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "object_links_workspace_select"
  ON public.object_links FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "object_links_workspace_insert"
  ON public.object_links FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "object_links_workspace_delete"
  ON public.object_links FOR DELETE
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- No UPDATE — links are replaced, not mutated.

-- ---------------------------------------------------------------------------
-- box_object_attachments
--   Workspace owner manages all attachments within their workspace.
--   Attachments are immutable join rows — no UPDATE policy.
-- ---------------------------------------------------------------------------

ALTER TABLE public.box_object_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "box_object_attachments_workspace_select"
  ON public.box_object_attachments FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "box_object_attachments_workspace_insert"
  ON public.box_object_attachments FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "box_object_attachments_workspace_delete"
  ON public.box_object_attachments FOR DELETE
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- No UPDATE — detach and re-attach to change placement or sort_order.
