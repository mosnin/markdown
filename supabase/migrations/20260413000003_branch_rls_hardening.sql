-- =============================================================================
-- Context Store — branch RLS and data-integrity hardening
-- Migration: 20260413000003_branch_rls_hardening.sql
--
-- The branch overlay system added `branch_id` columns to files, notes,
-- folders, boxes, and object_links (migrations 20260412000008 and
-- 20260412000009) so a draft row could exist alongside a main row
-- without colliding. Those migrations only addressed the unique-index
-- side of the story. The RLS side still governs every row by the
-- workspace-ownership helpers `owns_workspace` / `can_write_workspace`,
-- which evaluate true for any member of the workspace — so once
-- multiple members share a workspace, a viewer-authenticated session
-- can in principle SELECT / UPDATE / DELETE another member's draft
-- rows on the same table.
--
-- This migration closes three related gaps:
--
--   1. **Branch-access clause on RLS policies**. Every table that
--      carries `branch_id` gets its SELECT / INSERT / UPDATE / DELETE
--      policies rebuilt with an additional branch-access clause:
--
--         branch_id IS NULL
--         OR EXISTS (
--           SELECT 1 FROM draft_branches db
--           WHERE db.id = branch_id
--             AND public.<workspace-helper>(db.workspace_id)
--         )
--
--      Reads use `owns_workspace`, writes use `can_write_workspace`
--      matching the existing shape. The previous policies did not
--      inspect `branch_id` at all, so this adds a second gate rather
--      than replacing one.
--
--      Tables covered: notes, folders, boxes, files, object_links.
--      Skills and agents do NOT carry `branch_id` (see 20260412000007
--      `branch_package_metadata` — their branch-aware writes flow
--      through an overlay table, not a column on the canonical row)
--      so no branch clause applies there. The audit mentioned them
--      defensively but there is no column to gate on.
--
--   2. **`draft_branches` write policies too permissive**. The
--      rollback-foundations migration (20260412000004) created the
--      table with SELECT + ALL policies both gated by `owns_workspace`.
--      Overlay tables that depend on draft_branches — e.g.
--      `branch_pending_ops`, `folder_branch_overrides`,
--      `branch_placement_overrides` — already use `can_write_workspace`
--      for their own writes. Allowing a viewer-role member to create a
--      draft branch when they can't write any overlay row to it is
--      inconsistent and pointless. Tighten the write half of the
--      policy pair to `can_write_workspace` while leaving SELECT on
--      `owns_workspace` (a viewer must still see the branch list to
--      understand what the workspace contains).
--
--   3. **Zero-UUID sentinel collision risk**. The partial unique
--      indexes on files / notes / folders / boxes use
--      `COALESCE(branch_id, '00000000-...'::uuid)` to treat main
--      rows as if they were all on the same "branch". That works
--      as a sentinel only if application code cannot ever write a
--      `draft_branches.id` equal to the zero UUID. The FK to
--      `draft_branches(id)` makes the sentinel write impossible by
--      construction today (gen_random_uuid() has effectively zero
--      collision probability with the nil UUID), but a CHECK is
--      cheap and makes the intent explicit — if someone ever adds
--      a backfill or a seed that hardcodes a UUID, the CHECK
--      catches it rather than silently corrupting the index.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rebuild branch-aware RLS policies.
--
--    For each affected table we:
--
--      * DROP any existing SELECT/INSERT/UPDATE/DELETE policies that
--        were created by prior migrations (20260409000002_rls_policies,
--        20260411000002_object_model_rls, 20260412000005_rls_write_role_gate).
--      * Re-CREATE each policy with the original workspace gate AND
--        the new branch-access clause.
--
--    The branch-access clause is always safe for main rows
--    (branch_id IS NULL → clause is true) and for matching branches.
--    Mismatches fail closed.
-- ---------------------------------------------------------------------------

-- ============ notes ========================================================

DROP POLICY IF EXISTS "notes_workspace_select" ON public.notes;
CREATE POLICY "notes_workspace_select"
  ON public.notes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
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

DROP POLICY IF EXISTS "notes_workspace_insert" ON public.notes;
CREATE POLICY "notes_workspace_insert"
  ON public.notes FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_workspace(
      (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
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

DROP POLICY IF EXISTS "notes_workspace_update" ON public.notes;
CREATE POLICY "notes_workspace_update"
  ON public.notes FOR UPDATE
  TO authenticated
  USING (
    public.can_write_workspace(
      (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
    )
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.draft_branches db
        WHERE db.id = branch_id
          AND public.can_write_workspace(db.workspace_id)
      )
    )
  )
  WITH CHECK (
    public.can_write_workspace(
      (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
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

DROP POLICY IF EXISTS "notes_workspace_delete" ON public.notes;
CREATE POLICY "notes_workspace_delete"
  ON public.notes FOR DELETE
  TO authenticated
  USING (
    public.can_write_workspace(
      (SELECT b.workspace_id FROM public.boxes b WHERE b.id = box_id)
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

-- ============ folders ======================================================

DROP POLICY IF EXISTS "folders_workspace_select" ON public.folders;
CREATE POLICY "folders_workspace_select"
  ON public.folders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boxes b
      WHERE b.id = box_id
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

DROP POLICY IF EXISTS "folders_workspace_insert" ON public.folders;
CREATE POLICY "folders_workspace_insert"
  ON public.folders FOR INSERT
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

DROP POLICY IF EXISTS "folders_workspace_update" ON public.folders;
CREATE POLICY "folders_workspace_update"
  ON public.folders FOR UPDATE
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
  )
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

DROP POLICY IF EXISTS "folders_workspace_delete" ON public.folders;
CREATE POLICY "folders_workspace_delete"
  ON public.folders FOR DELETE
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

-- ============ boxes ========================================================

DROP POLICY IF EXISTS "boxes_workspace_select" ON public.boxes;
CREATE POLICY "boxes_workspace_select"
  ON public.boxes FOR SELECT
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

DROP POLICY IF EXISTS "boxes_workspace_insert" ON public.boxes;
CREATE POLICY "boxes_workspace_insert"
  ON public.boxes FOR INSERT
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

DROP POLICY IF EXISTS "boxes_workspace_update" ON public.boxes;
CREATE POLICY "boxes_workspace_update"
  ON public.boxes FOR UPDATE
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
  )
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

DROP POLICY IF EXISTS "boxes_workspace_delete" ON public.boxes;
CREATE POLICY "boxes_workspace_delete"
  ON public.boxes FOR DELETE
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

-- ============ files ========================================================
--
-- files carry the dual-scope pattern (box_id IS NULL → workspace level;
-- box_id IS NOT NULL → box → workspace chain). Preserve that shape,
-- then AND the branch-access clause on top.

DROP POLICY IF EXISTS "files_workspace_select" ON public.files;
CREATE POLICY "files_workspace_select"
  ON public.files FOR SELECT
  TO authenticated
  USING (
    (
      (box_id IS NULL AND public.owns_workspace(workspace_id))
      OR (box_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.boxes b
        WHERE b.id = box_id
          AND public.owns_workspace(b.workspace_id)
      ))
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

DROP POLICY IF EXISTS "files_workspace_insert" ON public.files;
CREATE POLICY "files_workspace_insert"
  ON public.files FOR INSERT
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

DROP POLICY IF EXISTS "files_workspace_update" ON public.files;
CREATE POLICY "files_workspace_update"
  ON public.files FOR UPDATE
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
  )
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

DROP POLICY IF EXISTS "files_workspace_delete" ON public.files;
CREATE POLICY "files_workspace_delete"
  ON public.files FOR DELETE
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

-- ============ object_links =================================================
--
-- object_links has SELECT / INSERT / DELETE only (links are replaced
-- not mutated — there is no UPDATE policy to preserve).

DROP POLICY IF EXISTS "object_links_workspace_select" ON public.object_links;
CREATE POLICY "object_links_workspace_select"
  ON public.object_links FOR SELECT
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

DROP POLICY IF EXISTS "object_links_workspace_insert" ON public.object_links;
CREATE POLICY "object_links_workspace_insert"
  ON public.object_links FOR INSERT
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

DROP POLICY IF EXISTS "object_links_workspace_delete" ON public.object_links;
CREATE POLICY "object_links_workspace_delete"
  ON public.object_links FOR DELETE
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

-- ---------------------------------------------------------------------------
-- 2. Tighten draft_branches write policies.
--
--    The previous policy used `owns_workspace` for FOR ALL, meaning
--    any member could create / update / delete a draft branch. Overlay
--    tables already gate writes on `can_write_workspace`, so the
--    branch row itself should too. SELECT stays on `owns_workspace`
--    — viewers need to see the branch list.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS draft_branches_workspace_write ON public.draft_branches;

CREATE POLICY draft_branches_workspace_insert
  ON public.draft_branches FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_workspace(workspace_id));

CREATE POLICY draft_branches_workspace_update
  ON public.draft_branches FOR UPDATE
  TO authenticated
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

CREATE POLICY draft_branches_workspace_delete
  ON public.draft_branches FOR DELETE
  TO authenticated
  USING (public.can_write_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 3. Block the zero-UUID sentinel on every branch_id column.
--
--    The partial unique indexes treat '00000000-...'::uuid as the
--    "main" sentinel via COALESCE. If application code ever writes
--    that exact UUID as a real branch_id, the unique index would
--    collapse main and branch rows into the same partition and the
--    overlay would return wrong rows. The FK to draft_branches plus
--    gen_random_uuid() defaults make this astronomically unlikely,
--    but a CHECK is cheap and makes the intent auditable.
-- ---------------------------------------------------------------------------

ALTER TABLE public.notes
  ADD CONSTRAINT notes_branch_id_not_zero_uuid_chk
  CHECK (branch_id IS NULL OR branch_id <> '00000000-0000-0000-0000-000000000000'::uuid);

ALTER TABLE public.folders
  ADD CONSTRAINT folders_branch_id_not_zero_uuid_chk
  CHECK (branch_id IS NULL OR branch_id <> '00000000-0000-0000-0000-000000000000'::uuid);

ALTER TABLE public.boxes
  ADD CONSTRAINT boxes_branch_id_not_zero_uuid_chk
  CHECK (branch_id IS NULL OR branch_id <> '00000000-0000-0000-0000-000000000000'::uuid);

ALTER TABLE public.files
  ADD CONSTRAINT files_branch_id_not_zero_uuid_chk
  CHECK (branch_id IS NULL OR branch_id <> '00000000-0000-0000-0000-000000000000'::uuid);

ALTER TABLE public.object_links
  ADD CONSTRAINT object_links_branch_id_not_zero_uuid_chk
  CHECK (branch_id IS NULL OR branch_id <> '00000000-0000-0000-0000-000000000000'::uuid);

-- Skills / agents do not carry a branch_id column (branch-aware writes
-- flow through branch_package_metadata), so no CHECK applies.
