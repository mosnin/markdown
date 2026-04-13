-- =============================================================================
-- Context Store — branch_id on note_links + box_object_attachments
-- Migration: 20260413000005_note_links_and_attachments_branch_id.sql
--
-- Two tables still had no branch-ownership column, so creating a link
-- or attaching a reusable skill/agent while on a branch leaked the row
-- straight onto main:
--
--   1. `note_links` — the note-to-note semantic link table. Branch
--      create/update/delete all wrote canonical rows.
--   2. `box_object_attachments` — attaching a reusable skill or agent
--      to a box wrote the attachment row on main even when the author
--      was editing on a draft branch. Detach already routes through
--      `branch_pending_ops` (`object_type='box_object_attachment'`,
--      `op_type='detach'`) so that half was safe, but attach still
--      leaked.
--
-- Design follows the same shape as files.branch_id / object_links.branch_id
-- (migration 20260412000008) and the RLS hardening from 20260413000003:
--
--   * Nullable FK to `draft_branches(id) ON DELETE SET NULL`. Main
--     rows have `branch_id IS NULL`; branch-local rows have the
--     column set.
--   * CHECK blocking the zero UUID so the COALESCE sentinel can't
--     collide with a real branch row (matches files / notes / folders
--     / boxes / object_links).
--   * The two affected unique indexes are rebuilt with
--     `COALESCE(branch_id, '00000000-...'::uuid)` so a draft and a
--     main row with otherwise-identical keys don't collide at insert
--     time.
--   * RLS policies rebuilt with the branch-access clause from
--     20260413000003 so a member on workspace A can't touch another
--     workspace's branch rows, and so a branch row is visible only
--     when the active session's workspace owns its branch.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. note_links.branch_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.note_links
  ADD COLUMN branch_id uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL;

CREATE INDEX note_links_branch_id_idx
  ON public.note_links (branch_id)
  WHERE branch_id IS NOT NULL;

ALTER TABLE public.note_links
  ADD CONSTRAINT note_links_branch_id_not_zero_uuid_chk
  CHECK (branch_id IS NULL OR branch_id <> '00000000-0000-0000-0000-000000000000'::uuid);

-- The original UNIQUE (source_note_id, target_note_id, relationship_type)
-- has to become a branch-aware partial unique index so a main link and
-- a branch-local link can coexist with the same shape.
ALTER TABLE public.note_links
  DROP CONSTRAINT IF EXISTS note_links_source_note_id_target_note_id_relationship_type_key;

CREATE UNIQUE INDEX note_links_source_target_type_branch_uidx
  ON public.note_links (
    source_note_id,
    target_note_id,
    relationship_type,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- 2. box_object_attachments.branch_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.box_object_attachments
  ADD COLUMN branch_id uuid REFERENCES public.draft_branches(id) ON DELETE SET NULL;

CREATE INDEX box_object_attachments_branch_id_idx
  ON public.box_object_attachments (branch_id)
  WHERE branch_id IS NOT NULL;

ALTER TABLE public.box_object_attachments
  ADD CONSTRAINT box_object_attachments_branch_id_not_zero_uuid_chk
  CHECK (branch_id IS NULL OR branch_id <> '00000000-0000-0000-0000-000000000000'::uuid);

-- Rebuild UNIQUE (box_id, object_type, object_id) to include branch_id
-- in the same way as files_box_path_cache_active_uidx.
ALTER TABLE public.box_object_attachments
  DROP CONSTRAINT IF EXISTS box_object_attachments_box_id_object_type_object_id_key;

CREATE UNIQUE INDEX box_object_attachments_box_object_branch_uidx
  ON public.box_object_attachments (
    box_id,
    object_type,
    object_id,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- 3. Extend branch_pending_ops.object_type CHECK to include 'note_link'.
--
--    Detaching a note_link on a branch needs to route through
--    `branch_pending_ops` the same way object_link detach already does
--    — a main-routed note_link can't be hard-deleted in place without
--    leaking intent onto main before promote.
-- ---------------------------------------------------------------------------

ALTER TABLE public.branch_pending_ops
  DROP CONSTRAINT IF EXISTS branch_pending_ops_object_type_check;

ALTER TABLE public.branch_pending_ops
  ADD CONSTRAINT branch_pending_ops_object_type_check
  CHECK (object_type IN (
    'note', 'file', 'folder', 'skill', 'agent',
    'object_link', 'box_object_attachment', 'note_link'
  ));

-- ---------------------------------------------------------------------------
-- 4. Rebuild RLS policies with the branch-access clause.
--
--    note_links derives workspace through source_note → box → workspace
--    (same shape as the original policies in 20260409000002). The
--    branch-access clause is the one from 20260413000003:
--
--      branch_id IS NULL
--      OR EXISTS (SELECT 1 FROM draft_branches db
--                 WHERE db.id = branch_id
--                   AND public.<workspace_helper>(db.workspace_id))
--
--    SELECT uses owns_workspace, writes use can_write_workspace.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "note_links_workspace_select" ON public.note_links;
CREATE POLICY "note_links_workspace_select"
  ON public.note_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notes n
      JOIN public.boxes b ON b.id = n.box_id
      WHERE n.id = source_note_id
        AND public.owns_workspace(b.workspace_id)
    )
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.draft_branches db
        WHERE db.id = branch_id
          AND public.owns_workspace(db.workspace_id)
      )
    )
  );

DROP POLICY IF EXISTS "note_links_workspace_insert" ON public.note_links;
CREATE POLICY "note_links_workspace_insert"
  ON public.note_links FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_workspace(
      (SELECT b.workspace_id FROM public.boxes b
       JOIN public.notes n ON n.box_id = b.id
       WHERE n.id = source_note_id)
    )
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.draft_branches db
        WHERE db.id = branch_id
          AND public.can_write_workspace(db.workspace_id)
      )
    )
  );

DROP POLICY IF EXISTS "note_links_workspace_delete" ON public.note_links;
CREATE POLICY "note_links_workspace_delete"
  ON public.note_links FOR DELETE
  TO authenticated
  USING (
    public.can_write_workspace(
      (SELECT b.workspace_id FROM public.boxes b
       JOIN public.notes n ON n.box_id = b.id
       WHERE n.id = source_note_id)
    )
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.draft_branches db
        WHERE db.id = branch_id
          AND public.can_write_workspace(db.workspace_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. box_object_attachments RLS — rebuild with the branch-access clause.
--
--    Unlike note_links, `box_object_attachments` has workspace_id
--    directly on the row. The originals gate writes on
--    can_write_workspace(workspace_id); select leans on the same
--    helper (introduced in 20260412000005). We add the branch clause
--    and make the select explicit so read access is symmetric with
--    the write-path policies.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "box_object_attachments_workspace_select"
  ON public.box_object_attachments;
CREATE POLICY "box_object_attachments_workspace_select"
  ON public.box_object_attachments FOR SELECT
  TO authenticated
  USING (
    public.owns_workspace(workspace_id)
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.draft_branches db
        WHERE db.id = branch_id
          AND public.owns_workspace(db.workspace_id)
      )
    )
  );

DROP POLICY IF EXISTS "box_object_attachments_workspace_insert"
  ON public.box_object_attachments;
CREATE POLICY "box_object_attachments_workspace_insert"
  ON public.box_object_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_workspace(workspace_id)
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.draft_branches db
        WHERE db.id = branch_id
          AND public.can_write_workspace(db.workspace_id)
      )
    )
  );

DROP POLICY IF EXISTS "box_object_attachments_workspace_delete"
  ON public.box_object_attachments;
CREATE POLICY "box_object_attachments_workspace_delete"
  ON public.box_object_attachments FOR DELETE
  TO authenticated
  USING (
    public.can_write_workspace(workspace_id)
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.draft_branches db
        WHERE db.id = branch_id
          AND public.can_write_workspace(db.workspace_id)
      )
    )
  );
