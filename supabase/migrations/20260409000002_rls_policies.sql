-- =============================================================================
-- Context Store — Row Level Security policies
-- Migration: 20260409000002_rls_policies.sql
--
-- RLS model (V1 — single owner):
--   Each workspace is owned by exactly one auth.users record.
--   All child tables derive access from workspace ownership.
--   Connection token authorization is NOT handled here — it is enforced
--   by the API/MCP layer. These policies cover human session access only.
--
-- Policy naming convention:
--   <table>_owner_<operation>  for workspace-level policies
--   <table>_workspace_<operation> for child table policies
-- =============================================================================

-- ---------------------------------------------------------------------------
-- workspaces
--   The owner can read and write their own workspaces.
--   No other authenticated user can see another's workspace.
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspaces_owner_select"
  ON public.workspaces FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "workspaces_owner_insert"
  ON public.workspaces FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "workspaces_owner_update"
  ON public.workspaces FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "workspaces_owner_delete"
  ON public.workspaces FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- boxes
--   Readable and writable by the workspace owner via owns_workspace().
-- ---------------------------------------------------------------------------

ALTER TABLE public.boxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boxes_workspace_select"
  ON public.boxes FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "boxes_workspace_insert"
  ON public.boxes FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "boxes_workspace_update"
  ON public.boxes FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "boxes_workspace_delete"
  ON public.boxes FOR DELETE
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- folders
--   Derives access through the box → workspace ownership chain.
-- ---------------------------------------------------------------------------

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folders_workspace_select"
  ON public.folders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "folders_workspace_insert"
  ON public.folders FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "folders_workspace_update"
  ON public.folders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "folders_workspace_delete"
  ON public.folders FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- notes
--   Derives access through the box → workspace ownership chain.
-- ---------------------------------------------------------------------------

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_workspace_select"
  ON public.notes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "notes_workspace_insert"
  ON public.notes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "notes_workspace_update"
  ON public.notes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "notes_workspace_delete"
  ON public.notes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- note_versions
--   Append-only. Owners may SELECT and INSERT. No UPDATE or DELETE.
--   Derives access through note → box → workspace.
-- ---------------------------------------------------------------------------

ALTER TABLE public.note_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "note_versions_workspace_select"
  ON public.note_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notes n
      JOIN public.boxes b ON b.id = n.box_id
      WHERE n.id = note_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "note_versions_workspace_insert"
  ON public.note_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.notes n
      JOIN public.boxes b ON b.id = n.box_id
      WHERE n.id = note_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

-- No UPDATE policy — note_versions are immutable.
-- No DELETE policy — note_versions are retained.

-- ---------------------------------------------------------------------------
-- note_links
--   Derives access through source_note → box → workspace.
-- ---------------------------------------------------------------------------

ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "note_links_workspace_select"
  ON public.note_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notes n
      JOIN public.boxes b ON b.id = n.box_id
      WHERE n.id = source_note_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "note_links_workspace_insert"
  ON public.note_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.notes n
      JOIN public.boxes b ON b.id = n.box_id
      WHERE n.id = source_note_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

CREATE POLICY "note_links_workspace_delete"
  ON public.note_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notes n
      JOIN public.boxes b ON b.id = n.box_id
      WHERE n.id = source_note_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

-- No UPDATE — links are replaced, not mutated.

-- ---------------------------------------------------------------------------
-- connections
--   Workspace owner manages connections.
-- ---------------------------------------------------------------------------

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connections_workspace_select"
  ON public.connections FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "connections_workspace_insert"
  ON public.connections FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "connections_workspace_update"
  ON public.connections FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "connections_workspace_delete"
  ON public.connections FOR DELETE
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- connection_tokens
--   Derives access through connection → workspace.
--   Connection token verification by external agents is handled in the
--   API layer — not via RLS direct access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.connection_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connection_tokens_workspace_select"
  ON public.connection_tokens FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.id = connection_id
        AND public.owns_workspace(c.workspace_id)
    )
  );

CREATE POLICY "connection_tokens_workspace_insert"
  ON public.connection_tokens FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.id = connection_id
        AND public.owns_workspace(c.workspace_id)
    )
  );

CREATE POLICY "connection_tokens_workspace_update"
  ON public.connection_tokens FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.id = connection_id
        AND public.owns_workspace(c.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.id = connection_id
        AND public.owns_workspace(c.workspace_id)
    )
  );

-- No hard delete — revoke by setting status = 'revoked'.

-- ---------------------------------------------------------------------------
-- connection_box_scopes
--   Derives access through connection → workspace.
-- ---------------------------------------------------------------------------

ALTER TABLE public.connection_box_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connection_box_scopes_workspace_select"
  ON public.connection_box_scopes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.id = connection_id
        AND public.owns_workspace(c.workspace_id)
    )
  );

CREATE POLICY "connection_box_scopes_workspace_insert"
  ON public.connection_box_scopes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.id = connection_id
        AND public.owns_workspace(c.workspace_id)
    )
  );

CREATE POLICY "connection_box_scopes_workspace_delete"
  ON public.connection_box_scopes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.id = connection_id
        AND public.owns_workspace(c.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- write_proposals
--   Human session: workspace owner sees and reviews proposals.
-- ---------------------------------------------------------------------------

ALTER TABLE public.write_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "write_proposals_workspace_select"
  ON public.write_proposals FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "write_proposals_workspace_insert"
  ON public.write_proposals FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY "write_proposals_workspace_update"
  ON public.write_proposals FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

-- No hard delete — cancel by setting status = 'canceled'.

-- ---------------------------------------------------------------------------
-- audit_events
--   Append-only. Owners may SELECT and INSERT. No UPDATE or DELETE.
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_events_workspace_select"
  ON public.audit_events FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY "audit_events_workspace_insert"
  ON public.audit_events FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

-- No UPDATE or DELETE — audit events are immutable.
