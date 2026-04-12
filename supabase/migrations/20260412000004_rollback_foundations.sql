-- =============================================================================
-- Context Store — rollback and restoration foundations
-- Migration: 20260412000004_rollback_foundations.sql
--
-- This migration lays down the durable tables that the product's
-- rollback / restore architecture depends on. It does NOT mutate any
-- existing content-bearing rows; it only adds new tables and nullable
-- link columns to existing tables. All of the existing version history
-- and audit semantics keep working unchanged.
--
-- New concepts (see docs/rollback_architecture_v1.md):
--
--   change_sets         — a grouped mutation (import, proposal approval,
--                         drag-move, folder rename cascade, rollback,
--                         branch promotion, manual multi-write, …).
--                         Every mutation — simple or grouped — should be
--                         wrapped in a change set going forward.
--   change_set_items    — per-object item inside a change set. Carries a
--                         compact before/after snapshot so a restore can
--                         rebuild the prior state without scanning the
--                         version graph for every object.
--   structural_events   — tree-shape mutations (move, reorder, attach,
--                         detach, folder rename, path cascade). Content
--                         text has its own version tables; structural
--                         state has no version table by itself, so we log
--                         the event with a before / after snapshot and
--                         reference the owning change set.
--   draft_branches      — foundation for exploratory editing. A branch
--                         is a handle under which working change sets can
--                         later be accumulated and either promoted or
--                         discarded. V1 schema only — branch promote /
--                         diff UI is deliberately out of scope here.
--   branch_heads        — for every (branch, object) pair the branch-
--                         visible head version (or tombstone). Only used
--                         by draft branches; the implicit "main" branch
--                         has no rows here and reads the canonical
--                         object.current_version_id.
--   restore_records     — the audit of a restore. Points at the source
--                         change set being undone and the new change set
--                         that actually wrote the undoing operations.
--                         Restores always produce new state; the past is
--                         immutable.
--
-- Columns added to existing tables:
--
--   audit_events.change_set_id       — optional group correlation.
--   note_versions.change_set_id      — which change set produced this
--                                      version.
--   object_versions.change_set_id    — same for files / skills / agents.
--   write_proposals.change_set_id    — which change set approved this
--                                      proposal (set at approval time).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. change_sets
-- ---------------------------------------------------------------------------

CREATE TABLE public.change_sets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- 'origin' classifies the trigger so restore flows can pick the right
  -- undo semantics. 'manual_edit' is the catch-all for a user-driven
  -- single-object save. A new version of this table should add origins
  -- additively; clients depend on the CHECK list.
  origin              text        NOT NULL
                                  CHECK (origin IN (
                                    'manual_edit',
                                    'import',
                                    'proposal_approval',
                                    'structural_move',
                                    'lifecycle',
                                    'rollback',
                                    'restore',
                                    'branch_promotion',
                                    'system'
                                  )),

  actor_type          text        NOT NULL
                                  CHECK (actor_type IN ('user', 'connection', 'system')),
  actor_id            text        NOT NULL,

  -- Optional free-text summary rendered in history surfaces.
  summary             text,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- The change set that preceded this one in restore lineage, if any.
  -- A "restore" change set points back at the change set it undoes;
  -- a "branch_promotion" points back at the draft change set that
  -- sourced the promotion. This keeps lineage traversable.
  parent_change_set_id uuid       REFERENCES public.change_sets(id) ON DELETE SET NULL,

  -- Status models the two-phase write pattern services use to guarantee
  -- the item list is complete before any observer believes in the
  -- change set. Always transition open → (committed | aborted).
  status              text        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'committed', 'aborted')),

  created_at          timestamptz NOT NULL DEFAULT now(),
  committed_at        timestamptz,
  aborted_at          timestamptz,

  -- Invariant: a terminal state must carry its timestamp.
  CHECK (
    (status = 'open'      AND committed_at IS NULL AND aborted_at IS NULL) OR
    (status = 'committed' AND committed_at IS NOT NULL AND aborted_at IS NULL) OR
    (status = 'aborted'   AND committed_at IS NULL AND aborted_at IS NOT NULL)
  )
);

CREATE INDEX change_sets_workspace_created_at_idx
  ON public.change_sets (workspace_id, created_at DESC);
CREATE INDEX change_sets_workspace_origin_idx
  ON public.change_sets (workspace_id, origin);
CREATE INDEX change_sets_parent_idx
  ON public.change_sets (parent_change_set_id)
  WHERE parent_change_set_id IS NOT NULL;

ALTER TABLE public.change_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY change_sets_workspace_select
  ON public.change_sets
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

-- Only the service layer (using the user's session) writes to change_sets;
-- WITH CHECK uses owns_workspace so every insert comes from a member.
CREATE POLICY change_sets_workspace_insert
  ON public.change_sets
  FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

CREATE POLICY change_sets_workspace_update
  ON public.change_sets
  FOR UPDATE
  TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

-- No DELETE policy: change_sets are append-only trust records. If a
-- change set must be effectively undone, call a restore flow; don't
-- delete the row.

-- ---------------------------------------------------------------------------
-- 2. change_set_items
-- ---------------------------------------------------------------------------

CREATE TABLE public.change_set_items (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id  uuid        NOT NULL REFERENCES public.change_sets(id) ON DELETE CASCADE,
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Operation tells the restore planner what kind of undo is needed:
  --   create        → on restore, mark the object trashed (or delete if
  --                   truly empty) so the creation is reversed
  --   update        → on restore, rewrite the target to before_snapshot
  --   restore       → undoing a prior restore restores the previous head
  --   archive/trash → undoing resets status
  --   move          → structural; see structural_events for the detail
  --   attach/detach → structural; see structural_events
  --   link_create / link_delete — optional, low-priority
  operation      text        NOT NULL
                             CHECK (operation IN (
                               'create',
                               'update',
                               'archive',
                               'unarchive',
                               'trash',
                               'restore_lifecycle',
                               'move',
                               'attach',
                               'detach',
                               'link_create',
                               'link_delete',
                               'rollback'
                             )),

  object_type    text        NOT NULL
                             CHECK (object_type IN (
                               'note', 'file', 'skill', 'agent',
                               'folder', 'box',
                               'note_link', 'object_link',
                               'box_object_attachment'
                             )),
  object_id      uuid        NOT NULL,

  -- version_id is populated when the item created a concrete version
  -- row; restores that target a content-bearing object thread through
  -- the version graph via this id rather than re-deriving from
  -- before_snapshot.
  version_id     uuid,

  -- Compact before/after snapshots. Schema is intentionally loose jsonb
  -- because the fields vary per object_type; the restore service is
  -- responsible for validating what it reads here.
  before_snapshot jsonb,
  after_snapshot  jsonb,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX change_set_items_change_set_id_idx
  ON public.change_set_items (change_set_id);
CREATE INDEX change_set_items_object_idx
  ON public.change_set_items (object_type, object_id, created_at DESC);

ALTER TABLE public.change_set_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY change_set_items_workspace_select
  ON public.change_set_items
  FOR SELECT
  TO authenticated
  USING (public.owns_workspace(workspace_id));

CREATE POLICY change_set_items_workspace_insert
  ON public.change_set_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

-- No UPDATE or DELETE: once recorded an item is immutable. Correcting a
-- mistake means writing a compensating change set.

-- ---------------------------------------------------------------------------
-- 3. structural_events
--
--   Fine-grained record of tree-shape mutations. Every row belongs to
--   exactly one change_set. The before / after snapshot captures enough
--   to undo the event losslessly:
--     folder_id, parent_folder_id, sort_order, path_cache.
--   A structural restore replays the inverse of each event in reverse
--   order within the change set.
-- ---------------------------------------------------------------------------

CREATE TABLE public.structural_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id   uuid        NOT NULL REFERENCES public.change_sets(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  box_id          uuid        REFERENCES public.boxes(id) ON DELETE SET NULL,

  event_type      text        NOT NULL
                              CHECK (event_type IN (
                                'move',            -- folder_id change for a leaf or folder
                                'reorder',         -- sort_order change only
                                'folder_rename',   -- name + slug + path_cache change
                                'path_cascade',    -- descendant path_cache rewrite
                                'attach',          -- reusable object attached to box
                                'detach',          -- reusable object detached from box
                                'folder_create',
                                'folder_delete'
                              )),

  object_type     text        NOT NULL
                              CHECK (object_type IN (
                                'note', 'file', 'skill', 'agent',
                                'folder', 'box_object_attachment'
                              )),
  object_id       uuid        NOT NULL,

  before_state    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  after_state     jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Sequence within the change set — used by the restore planner when it
  -- needs to unwind events in LIFO order.
  sequence        integer     NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX structural_events_change_set_sequence_idx
  ON public.structural_events (change_set_id, sequence);
CREATE INDEX structural_events_object_idx
  ON public.structural_events (object_type, object_id, created_at DESC);
CREATE INDEX structural_events_workspace_created_idx
  ON public.structural_events (workspace_id, created_at DESC);

ALTER TABLE public.structural_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY structural_events_workspace_select
  ON public.structural_events FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));
CREATE POLICY structural_events_workspace_insert
  ON public.structural_events FOR INSERT TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 4. draft_branches
--
--   Foundation for safe exploratory editing. Only the schema lands here;
--   promote / discard / compare services are built in a follow-up. A
--   branch has a human-readable name, a base_change_set_id that records
--   "what main looked like at the time of branching", and a status that
--   goes open → (promoted | discarded).
-- ---------------------------------------------------------------------------

CREATE TABLE public.draft_branches (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                 text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description          text,
  base_change_set_id   uuid        REFERENCES public.change_sets(id) ON DELETE SET NULL,
  created_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  status               text        NOT NULL DEFAULT 'open'
                                   CHECK (status IN ('open', 'promoted', 'discarded')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  promoted_at          timestamptz,
  discarded_at         timestamptz,

  UNIQUE (workspace_id, name)
);

CREATE INDEX draft_branches_workspace_status_idx
  ON public.draft_branches (workspace_id, status);

ALTER TABLE public.draft_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY draft_branches_workspace_select
  ON public.draft_branches FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));
CREATE POLICY draft_branches_workspace_write
  ON public.draft_branches FOR ALL TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 5. branch_heads
--
--   For each (branch, object) pair, the version the branch considers
--   current. For a draft branch this allows an object to diverge from
--   main without mutating the canonical current_version_id. Main branch
--   has no rows; readers fall back to the object's own current_version_id.
-- ---------------------------------------------------------------------------

CREATE TABLE public.branch_heads (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid        NOT NULL REFERENCES public.draft_branches(id) ON DELETE CASCADE,
  object_type  text        NOT NULL
                           CHECK (object_type IN ('note', 'file', 'skill', 'agent')),
  object_id    uuid        NOT NULL,
  -- Pointer into the version graph: note_versions.id for notes,
  -- object_versions.id for files/skills/agents. No DB FK because the
  -- target table is polymorphic. Validated at the service layer.
  version_id   uuid        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (branch_id, object_type, object_id)
);

CREATE INDEX branch_heads_branch_idx
  ON public.branch_heads (branch_id);
CREATE INDEX branch_heads_object_idx
  ON public.branch_heads (object_type, object_id);

CREATE TRIGGER branch_heads_set_updated_at
  BEFORE UPDATE ON public.branch_heads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.branch_heads ENABLE ROW LEVEL SECURITY;

-- Branch heads inherit access from their owning draft_branches row. A
-- USING clause that joins is fine because branch_heads is a small table
-- touched only when a draft branch is being edited.
CREATE POLICY branch_heads_access
  ON public.branch_heads
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_heads.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_branches b
      WHERE b.id = branch_heads.branch_id
        AND public.owns_workspace(b.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 6. restore_records
--
--   Each restore is itself a change set; this table is the audit of the
--   restore action. It points at the change set that was undone (source)
--   and the change set that did the undoing (restored_change_set_id).
-- ---------------------------------------------------------------------------

CREATE TABLE public.restore_records (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id                  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What restore scope was requested. 'version' means "restore one
  -- object to a specific historical version"; 'change_set' means "undo
  -- this entire change set"; 'structural' is a targeted tree-only undo.
  scope                     text        NOT NULL
                                        CHECK (scope IN ('version', 'change_set', 'structural', 'import')),

  source_change_set_id      uuid        REFERENCES public.change_sets(id) ON DELETE SET NULL,
  source_version_id         uuid,       -- for scope = 'version'
  restored_change_set_id    uuid        REFERENCES public.change_sets(id) ON DELETE SET NULL,

  status                    text        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'applied', 'failed', 'aborted')),
  error                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  applied_at                timestamptz
);

CREATE INDEX restore_records_workspace_created_idx
  ON public.restore_records (workspace_id, created_at DESC);
CREATE INDEX restore_records_source_change_set_idx
  ON public.restore_records (source_change_set_id);

ALTER TABLE public.restore_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY restore_records_workspace_select
  ON public.restore_records FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));
CREATE POLICY restore_records_workspace_insert
  ON public.restore_records FOR INSERT TO authenticated
  WITH CHECK (public.owns_workspace(workspace_id));
CREATE POLICY restore_records_workspace_update
  ON public.restore_records FOR UPDATE TO authenticated
  USING (public.owns_workspace(workspace_id))
  WITH CHECK (public.owns_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 7. Nullable change_set_id columns on existing tables
--
--   These are the correlation handles that turn a standalone row into a
--   grouped operation. Every column is nullable so legacy rows written
--   before this migration remain valid — they simply aren't grouped.
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_events
  ADD COLUMN change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL;
CREATE INDEX audit_events_change_set_id_idx
  ON public.audit_events (change_set_id)
  WHERE change_set_id IS NOT NULL;

ALTER TABLE public.note_versions
  ADD COLUMN change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL;
CREATE INDEX note_versions_change_set_id_idx
  ON public.note_versions (change_set_id)
  WHERE change_set_id IS NOT NULL;

ALTER TABLE public.object_versions
  ADD COLUMN change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL;
CREATE INDEX object_versions_change_set_id_idx
  ON public.object_versions (change_set_id)
  WHERE change_set_id IS NOT NULL;

ALTER TABLE public.write_proposals
  ADD COLUMN change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL;
CREATE INDEX write_proposals_change_set_id_idx
  ON public.write_proposals (change_set_id)
  WHERE change_set_id IS NOT NULL;
