# Branch-local structural creation — v1

Skills and Agents already branched their canonical source, child-file
content, and package metadata. The last structural gap: **creating**
a new child file or attaching a Skill to an Agent while on a branch
still landed directly on main. This document describes the schema
and service-layer changes that close it.

## The gap

Previously:

- Clicking "New file" on a Skill detail page while a branch was
  active wrote to `files` with `branch_id` implicit-main. Every user
  (and every branch) saw the new file.
- Attaching a Skill to an Agent on a branch wrote an `object_links`
  row that landed on main immediately.

Both violated the "branches must not silently mutate main" trust
rule. This pass gives both tables a real branch-ownership column.

## Schema

Migration `20260412000008_branch_scoped_structural_rows.sql`:

- `files.branch_id` — nullable FK to `draft_branches(id)`,
  `ON DELETE SET NULL`. Main rows have `branch_id IS NULL`; branch-
  local rows have it set.
- The unique index `files_box_path_cache_active_uidx` is rebuilt
  with `COALESCE(branch_id, '00000000-...'::uuid)` as part of the
  key so a draft file and a main file can share a `path_cache`
  without colliding.
- `object_links.branch_id` — same nullable FK shape. No index
  rebuild needed; `object_links` uniqueness is already tight enough
  via `(source, target, relationship_type)`, and semantically a
  draft + main pair for the same (source, target, relationship)
  tuple is the caller's problem (we short-circuit the branch write
  when a matching main row already exists).

## Services

### `createFileOnBranch` in `src/server/services/file_service.ts`

Wraps the existing `createFile` RPC flow, then stamps `branch_id`
on the resulting row and fires a `file.branch_created` audit event
distinct from `file.created`. Used by:

- `createSkillChildFileAction` when `ctx.activeBranchId` is set
- `createAgentChildFileAction` same
- (future: raw new-file entry points — today they still call
  `createFile` directly on main)

### Extended reads

- `listFilesByBox(supabase, boxId, { branchId })` — `branchId: null`
  returns main-only (`branch_id IS NULL`); a uuid returns
  `branch_id IS NULL OR branch_id = <uuid>`.
- `getLinksForObject(supabase, workspaceId, objectType, objectId,
  { branchId })` applies the same filter to `object_links`.
- Detail pages (`app/skills/[id]`, `app/agents/[id]`,
  `app/files/[id]` — already flowing through the readers that now
  accept `branchId`) pass `ctx.activeBranchId`.

### `attachSkillToAgentAction`

When a branch is active, the newly-created `object_links` row gets
`branch_id` stamped immediately after insert. Detach still runs
through the main-only path — the attachment is either main or
branch, never both.

### `promoteBranch`

After the version-head + metadata-overlay loops, it now:

1. Clears `branch_id` on every `files` row where
   `branch_id = <branch>` (the file becomes main).
2. Clears `branch_id` on every `object_links` row in the same way.

Each promoted row gets a `change_set_item` with
`before_snapshot: { branch_id }` and `after_snapshot` capturing the
structural identity so the restore engine can revert.

### Discard

`discardBranchAction` hard-deletes `files` and `object_links` rows
with matching `branch_id` **before** marking the branch discarded.
Rationale: these rows never reached main and have no audit history
to preserve. `branch_heads` rows pointing at them are left intact
as record of intent.

## Diff surface

`branch_diff_service.getBranchDiff` now loads branch-created files
in addition to `branch_heads`-derived rows. Each appears with
`mainContent = null` / `mainBytes = 0` / `mainVersionId = null`,
matching the existing "deleted on main" edge case shape. The UI
renders them as "new on branch" side-by-side panels (the main
column is empty; the branch column shows the new content).

Package grouping still works: a branch-created file with
`parent_skill_id = X` is grouped under Skill X's card alongside
edits to existing child files.

## Tests

`src/tests/unit/branch_local_structural.test.ts` (7 cases):

- `listFilesByBox` with no branchId returns only main rows
- `listFilesByBox` with a branchId returns main + that branch's rows
- Other branches' drafts stay invisible
- `getLinksForObject` applies the same filter to both outgoing + incoming links

`src/tests/unit/pending_op_service.test.ts` — covers `recordPendingOp`
upsert shape, `getHiddenByPendingOps` filter semantics, `dropPendingOps`
scoping, `dropAllPendingOpsForBranch`, and `applyPendingOp` for every
op_type (trash / archive / unarchive / move / detach + empty-payload
move + unsupported target rejection).

## What's branch-aware now vs. still on main

| Operation                                    | Branch-aware? |
|----------------------------------------------|:-------------:|
| Edit an existing note / file / skill / agent | ✅            |
| Edit Skill/Agent metadata                    | ✅ (overlay)  |
| **Create a new note**                        | ✅            |
| **Create a new file**                        | ✅            |
| **Create a new folder**                      | ✅            |
| **Create a new box**                         | ✅            |
| **Attach Skill → Agent**                     | ✅            |
| **Detach Skill from Agent on branch**        | ✅ (pending op) |
| **Move file between folders on branch**      | ✅ (pending op) |
| **Trash / archive object on branch**         | ✅ (pending op) |
| Child folder nesting / reorder on branch     | ✅ (override overlay) |

## Soft-delete / move / detach on branch (landed v1.5)

The remaining structural operations all needed a persisted intent
that says *"this main-routed row should be gone / moved / detached
once we promote"*. The `branch_id` column on the row itself can't
express that cleanly: it means "row exists only on the branch", not
"branch wants to hide a main row".

### Schema

Migration `20260412000010_branch_pending_ops.sql` introduces:

```sql
CREATE TABLE branch_pending_ops (
  id           uuid PRIMARY KEY,
  branch_id    uuid NOT NULL REFERENCES draft_branches(id) ON DELETE CASCADE,
  op_type      text CHECK (op_type IN ('trash', 'archive', 'unarchive', 'move', 'detach')),
  object_type  text CHECK (object_type IN ('note', 'file', 'folder', 'skill', 'agent', 'object_link', 'box_object_attachment')),
  object_id    uuid NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  actor_id     uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz,
  UNIQUE (branch_id, op_type, object_type, object_id)
);
```

RLS joins through `draft_branches.workspace_id` so only workspace
members can read, only write-capable roles can insert/update. A
partial index on `(object_type, object_id) WHERE applied_at IS NULL`
makes the read-side hide query cheap.

### Service: `src/server/services/pending_op_service.ts`

- `recordPendingOp` upserts on the `(branch_id, op_type,
  object_type, object_id)` key, so a second call with the same
  shape is idempotent.
- `listPendingOps(branchId)` returns every unapplied op ordered by
  `created_at`.
- `dropPendingOps({ branchId, objectType, objectId, opType? })`
  lets the "swap" semantic work — if the user archives then
  unarchives on the same branch, we drop the archive op rather
  than stack an opposing one.
- `dropAllPendingOpsForBranch(branchId)` is the discard-path
  nuclear option.
- `getHiddenByPendingOps(branchId)` returns a `Set<"type:id">`
  containing only rows with a pending `trash` op. Archive / move
  / detach leave the source row visible at read time — only trash
  hides.
- `applyPendingOp(op)` is the per-op applier used on promote:
    - `trash` / `archive` / `unarchive` set the target row's
      `status` column (`trashed` / `archived` / `active`).
    - `move` writes only the payload-present keys among `box_id`,
      `folder_id`, `sort_order`, `path_cache`.
    - `detach` deletes the target row outright (for `object_link`
      and `box_object_attachment` only).
    - All of them set `branch_pending_ops.applied_at = now()`; the
      row is preserved for audit rather than deleted.

### Write-path wiring

- `runNoteLifecycle` in `app/notes/[note_id]/actions.ts` routes
  every archive / trash / unarchive through `recordPendingOp` when
  `ctx.activeBranchId` is set; the `withLifecycleChangeSet` flow
  on main is only reached when there's no active branch.
- The same pattern applies to unarchive / restore operations,
  which additionally call `dropPendingOps` on the opposing op
  type to implement swap semantics.

### Read-path overlays

- `listNotesByBox` and `listFilesByBox` load
  `getHiddenByPendingOps` once per page when `branchId` is set
  and filter hidden rows out of the result. Archive-visibility
  is unchanged since those rows stay active at read time.
- Other list views (folder trees, package children) inherit the
  same overlay via the shared repository readers.

### Promote

`promoteBranch` iterates `listPendingOps` after the heads and
metadata overlays are applied. Each `applyPendingOp` result is
recorded as a `change_set_item` with:

- `operation: <op_type>` — the CHECK on `change_set_items.operation`
  already covers `archive`, `unarchive`, `trash`, `move`, `detach`.
- `before_snapshot: { ...prior, branch_id, pending_op }`
- `after_snapshot: { ...patch, promoted_from_branch }`

so the rollback engine can revert the whole group.

### Discard

`discardBranchAction` calls `dropAllPendingOpsForBranch` after
hard-deleting branch-scoped rows; main is untouched, the intent
is thrown away.

### Diff surface

`branch_diff_service.getBranchDiff` now returns a `pendingOps`
field alongside `rows` / `packages` / `standalone`. Each entry
carries the op_type, object type/id, resolved display name, and
payload so the detail page can render a "Pending structural ops"
section with a one-line row per op. Move payloads produce a
compact `from → to` suffix; trash uses the destructive palette
so it's visually distinct from archive/unarchive.

## Child folder branching on branch (landed v1.6)

Folders still aren't versioned — we never ran a full
`object_versions` extension for them. Instead, *edits* to existing
main folders (rename / reparent / reorder) now route through a thin
overlay table that mirrors `branch_package_metadata`'s shape.

### Schema

Migration `20260413000001_folder_branch_overrides.sql`:

```sql
CREATE TABLE folder_branch_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES draft_branches(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  name             text,
  parent_folder_id uuid,
  sort_order       int,
  path_cache       text,
  actor_id         uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, folder_id)
);
```

Every overlay field is nullable; `NULL` means "no override for this
field, inherit from main". RLS joins through `draft_branches` and
uses `owns_workspace` / `can_write_workspace` identical to
`branch_package_metadata`.

### Service — `src/server/services/folder_branch_service.ts`

- `upsertFolderOverride({ branchId, folderId, actorId, patch })` —
  upserts on `(branch_id, folder_id)`. Patch is
  `{ name?, parent_folder_id?, sort_order?, path_cache? }`; only
  declared keys are written, so successive edits on the same folder
  merge into one overlay row.
- `getFolderOverride / listFolderOverridesForBranch` — reads used by
  the repository and diff surface.
- `applyOverrideToFolder` / `applyFolderOverridesToList` — pure
  functions. NULL override fields are skipped (inherit from main);
  non-null fields overlay the folder row. The input folder is never
  mutated.
- `promoteFolderOverrides(branchId)` — on promote, copies every
  overlay's non-null fields onto the canonical `folders` row (and
  `workspace_objects.sort_order` when the overlay sets that field).
  Returns `{ folderId, before, after }[]` so the change-set recorder
  can persist `change_set_items` with `operation: "update"`,
  `object_type: "folder"`.
- `dropFolderOverride / dropAllFolderOverridesForBranch` — rollback
  and discard paths; the latter runs after the branch-scoped
  hard-deletes in `discardBranchAction`.

### Read overlay

`folder_repository.listFoldersByBox(supabase, boxId, { branchId })`
now bulk-fetches every override for the branch after the folder
query returns, then patches each main row via
`applyFolderOverridesToList`. Branch-created folders (`branch_id`
non-null) are returned as-is since they have no main counterpart to
overlay. Main readers (no `branchId`) never touch the overrides
table.

`folder_repository.getFolderById(supabase, id, { branchId })`
applies the same overlay when the folder is a main row. Tree views,
breadcrumbs, and the box page all flow through these two readers.

### Write path

`renameFolderAction` (both `app/boxes/actions.ts` and
`app/boxes/tree_actions.ts`) routes through
`upsertFolderOverride` when `ctx.activeBranchId` is set and the
folder is a main row (`branch_id IS NULL`). Branch-created folders
are still updated directly — the overlay only protects main.

`moveTreeNodeAction` does the same for folder reparents: the
canonical `folders` row stays untouched, the intent lands as an
overlay, and descendant `path_cache` cascade is deferred to
promote, which re-derives the authoritative paths from the patched
parent.

### Promote + discard

- `promoteBranch` iterates `promoteFolderOverrides(branchId)` after
  pending-ops and records each change as a `change_set_item` with
  `before_snapshot: { ...before, branch_id }` and
  `after_snapshot: { ...after, promoted_from_branch }`.
- `discardBranchAction` calls `dropAllFolderOverridesForBranch`
  after the branch-scoped hard-deletes. Overlays only ever
  represented intent, main is untouched.

### Diff surface

`getBranchDiff` now returns `folderOverrides: FolderOverrideDiffRow[]`
alongside `rows` / `packages` / `pendingOps`. Each row lists the
fields that changed between main and the overlay (skipping NULL
override fields) and carries a resolved folder display name. The
branch detail client renders a "Folder changes" section with one
card per folder; fields reuse the existing `MetadataChangeRow`
component so the UI shape matches package metadata changes.

## v1.7 — Placement overrides close the reorder + cross-folder leak

The folder-overlay table closed renames and folder-tree edits, but
drag-and-drop reorder and cross-folder move (notes / files / skills /
agents / attachments inside the box tree) were still writing
canonical state on every drag. v1.7 introduces a sibling overlay
table — `branch_placement_overrides` — that captures `sort_order`
+ `folder_id` intent for any draggable tree entry while a branch
is active.

- Migration `20260413000002_branch_placement_overrides.sql` ships
  the table, indexes, and `FOR ALL` RLS policy modeled after
  `folder_branch_overrides`.
- Service `placement_branch_service.ts` exposes
  `upsertPlacementOverride`, `applyPlacementOverridesToList`,
  `promotePlacementOverrides`, and the per-branch / per-target
  drops.
- `loadSiblings` and `writeSiblingOrder` in
  `src/app/app/boxes/actions.ts` route through the overlay when
  `ctx.activeBranchId` is set; the cross-folder move and
  attachment folder-move arms of `moveTreeNodeAction` route the
  same way.
- Reader overlay in `listWorkspaceObjectsByBox` and
  `listAttachmentsForBox` keeps tree-page renders branch-aware
  without touching canonical rows.
- `promoteBranch` records each placement override as a
  `change_set_item` with `operation: "move"` (folder change) or
  `"update"` (sort-only); discard drops every overlay row.
- `getBranchDiff` returns `placementChanges`; the branch detail
  client renders a "Placement changes" section reusing
  `MetadataChangeRow`.

Full details: [branch_local_sort_order_and_reorder_isolation_v1.md](branch_local_sort_order_and_reorder_isolation_v1.md).

## v1.8 — Search and archived/trashed read-path coverage

Placement, folder, and box overlays already made the active content
surfaces branch-aware. Two read paths still ran with no branch
context and therefore leaked canonical state into branch sessions:

1. **Workspace search** — `searchWorkspaceAction` called
   `searchWorkspace(supabase, workspaceId, query)` with no branchId.
   The underlying SQL matched main rows only; a branch-created note
   never surfaced, and a branch-trashed row stayed visible.

2. **Folder detail page** — `src/app/app/folders/[folder_id]/page.tsx`
   ran inline `supabase.from(...)` queries for children and a
   breadcrumb loop via `getFolderById` without branchId. Renamed
   folders, branch-trashed children, and branch-created children all
   fell out of the view.

3. **Archived / trashed tabs** on the box page pulled from
   `listArchivedNotesByBox`, `listTrashedNotesByBox`, and the folder
   equivalents — none of which accepted a branchId or consulted
   `branch_pending_ops`. A user who archived a main row on their
   branch wouldn't see it in the Archived tab, and a canonical
   archived row the branch had unarchived would still appear.

v1.8 closes all three gaps:

- `workspace_search_service.searchWorkspace` now takes
  `opts.branchId`. Every per-type query applies the standard
  `branch_id IS NULL OR branch_id = <uuid>` predicate (boxes
  excepted — `boxes` is not branch-partitioned), and the hit loop
  filters through `getHiddenByPendingOps` so soft-trashed rows on
  the branch disappear. `searchWorkspaceAction` threads
  `ctx.activeBranchId ?? null` into the call.

- Folder detail page now calls the existing repository readers —
  `listNotesByBox`, `listFilesByBox`, `listSkillsByBox`,
  `listAgentsByBox`, `listFoldersByParent` — each scoped by
  `folder_id` plus `branchId`. The breadcrumb loop passes the same
  branchId to `getFolderById` so `folder_branch_overrides` renames
  render on the trail. `listSkillsByBox` and `listAgentsByBox`
  gained the branchId parameter to match the note/file readers,
  including the pending-op trash overlay.

- Archived / trashed readers gained a `branchId?: string | null`
  option with a symmetric overlay:
  * Canonical rows with `status = archived|trashed` and
    `branch_id IS NULL` are the base set (plus branch-local rows
    with the same status).
  * For archived, rows that have a pending `unarchive` op on this
    branch are dropped (the branch restored them).
  * Rows that have a pending `archive` (for the archived tab) or
    `trash` (for the trashed tab) op on this branch are fused in
    from the main-active set so branch-local intents surface in
    the right tab even though canonical status hasn't moved.

  The helper lives as `listLifecycleNotesByBox` /
  `listLifecycleFoldersByBox` inside each repository — one shared
  codepath per table, parameterised by the status + op type.

### Tests

`src/tests/unit/branch_archived_trashed_readers.test.ts` covers
three archived/trashed invariants for notes and folders: canonical
archived hidden by a branch unarchive op, main-active row surfaced
via a branch trash op, and a canonical archived row passing
through untouched when the branch has no conflicting op.

Baseline 358 → 364 tests after the batch.

## v1.9 — Close the lifecycle + rename + box-update leaks

Four narrow but load-bearing mutation paths still wrote straight to
main when a draft branch was active, leaking draft intent into every
other reader:

1. **`updateAgentStatusAction`** and the per-op
   `archive/unarchive/trash/restoreAgentAction` helpers — flipped
   `agents.status` directly.
2. **`updateFileStatusAction`** and the per-op
   `archive/unarchive/trash/restoreFileAction` helpers — flipped
   `files.status` directly.
3. **`archive/unarchive/trash/restoreSkillAction`** — flipped
   `skills.status` directly. (`updateSkillStatusAction` does not
   exist; the lifecycle endpoints are the only lifecycle surface.)
4. **`renameSkillAction`** — wrote `skills.name` and
   `workspace_objects.display_name` directly.
5. **`updateBoxAction`** — wrote `boxes.name` / `boxes.description`
   directly.

### Shared lifecycle router

`src/server/services/lifecycle_branch_router.ts` factors the
branch-routing shape that `runNoteLifecycle` inlined: when
`branchId` is set, record a `branch_pending_ops` intent and bail.
When no branch is active, return `{ appliedToMain: true }` and let
the caller run its existing main-mutating code. Swap semantics
preserved: `unarchive` drops a prior `archive` op, `restore_lifecycle`
drops a prior `trash` op — neither ever records a positive
unarchive / restore intent, matching the note pattern.

Wired into:
- `updateAgentStatusAction` (boxes/agents/actions.ts)
- `updateFileStatusAction` (files/actions.ts)
- `archiveAgentAction` / `unarchiveAgentAction` / `trashAgentAction` / `restoreAgentAction`
- `archiveFileAction` / `unarchiveFileAction` / `trashFileAction` / `restoreFileAction`
- `archiveSkillAction` / `unarchiveSkillAction` / `trashSkillAction` / `restoreSkillAction`

Branch-local files (rows whose `branch_id` already points at the
active branch) fall through to the in-place lifecycle path — the
whole row belongs to the branch, no intent needed.

### Skill rename via the package overlay

`branch_package_metadata` gained a `name` column (migration
`20260413000004_branch_metadata_overlays_v2.sql`).
`renameSkillAction` routes through `upsertPackageMetadataOverlay`
with `name` set when a branch is active. Branch reads already
overlay the package metadata; with `name` added to
`branchableMetadataFieldsFor`, the new name surfaces on every
skill read on the branch without touching main.

Promote (`branch_service.promoteBranch`) patches the overlay onto
`skills` / `agents` AND syncs the denormalized
`workspace_objects.display_name` when the overlay renamed the
package. Discard hard-deletes the overlay row as before (the
overlay purge was already wired).

### Box metadata overlay

Boxes needed the same treatment for name / description but
`branch_package_metadata` is skill/agent-specific (the
`package_type` CHECK blocks `'box'`; the agent-only columns are
dead weight). We stand up a dedicated overlay:

- Table: `box_branch_metadata_overlay` with columns
  `(id, branch_id, box_id, name, description, created_at, updated_at)`
  and a unique `(branch_id, box_id)` constraint.
- Service: `src/server/services/box_branch_metadata_service.ts` —
  upsert / get / list / applyOnRead / derive-diff-changes /
  promote / drop-all-for-branch. API mirrors the package overlay.
- Write path: `updateBoxAction` branches on `ctx.activeBranchId`;
  branch-created boxes (`branch_id` = active branch) still update
  in place, only main rows route to the overlay.
- Read path: `getBoxForWorkspace` takes an optional `branchId` and
  applies the overlay via `applyBoxMetadataOverlay`.
- Promote: `promoteBoxOverlays(supabase, branchId)` patches main
  and syncs `workspace_objects.display_name` on rename, returning
  before/after pairs for `change_set_items`.
- Discard: `dropAllBoxOverlaysForBranch(supabase, branchId)` in the
  `discardBranchAction` sequence.
- Diff surface: `BranchDiff.boxMetadataChanges` resolves every
  overlay into a before/after row with a display name.

Design note: a dedicated table keeps the schema honest. Extending
`branch_package_metadata` to include boxes would have required
loosening the `package_type` CHECK, broadening the RLS policies,
and threading "box" through the agent-only promote branches — all
for two shared columns.

### Null semantics on overlays

Both overlays (`branch_package_metadata` and
`box_branch_metadata_overlay`) treat `NULL` on a column as "no
override": the overlay row stores null for every column the user
hasn't explicitly set, and reads must treat null symmetrically with
"inherit from main" so a partial upsert (e.g. only `name`) doesn't
wipe `description`. `applyPackageMetadataOverlay` was slightly
stricter before v1.9 — it treated explicit null as "clear" — but
the write surface had no way to express "explicit clear" and the
only caller that set multiple fields at once did so transactionally,
so the change is a correction rather than a break.

### Tests

- `src/tests/unit/lifecycle_branch_router.test.ts` — five invariants
  covering main fall-through, archive + trash intent-recording,
  unarchive / restore swap semantics.
- `src/tests/unit/box_branch_metadata_service.test.ts` — upsert
  shape, apply-on-read, null = no override.
- `src/tests/unit/package_rename_overlay.test.ts` — name overlay
  shape for skills, agent-only field drop, name applied on read.

Baseline 364 → 377 tests after the batch.

## v1.10 — note_links + box_object_attachments branch isolation

Two tables still had no branch-ownership column, so creating a
note-to-note link or attaching a reusable Skill/Agent on a draft
branch wrote straight to the canonical row. Detach already routed
through `branch_pending_ops` (`object_type='box_object_attachment'`,
`op_type='detach'`) so that half was safe, but the attach /
link-create path still leaked.

### Schema

Migration `20260413000005_note_links_and_attachments_branch_id.sql`:

- `note_links.branch_id` — nullable FK to `draft_branches(id) ON
  DELETE SET NULL`, with a CHECK blocking the zero UUID (matches the
  sentinel safeguard from 20260413000003).
- `box_object_attachments.branch_id` — same shape + CHECK.
- Unique indexes rebuilt with the COALESCE sentinel so a main row and
  a branch-local row with otherwise-identical keys don't collide:
  - `note_links_source_target_type_branch_uidx` replaces the
    `UNIQUE (source_note_id, target_note_id, relationship_type)`
    constraint.
  - `box_object_attachments_box_object_branch_uidx` replaces the
    `UNIQUE (box_id, object_type, object_id)` constraint.
- `branch_pending_ops.object_type` CHECK extended with `'note_link'`
  so detach of a main note_link on a branch can record an intent.
- RLS rebuilt for both tables with the branch-access clause from
  `branch_rls_hardening_v1.md`:
  `branch_id IS NULL OR EXISTS (… draft_branches db … workspace_id)`.
  `box_object_attachments` picks up an explicit SELECT policy; it
  previously derived access from the old workspace gate only.

### Services + write path

- `object_link_service.createLink` now accepts `branchId` and stamps
  the column on insert via the repo. Old callers that used the
  post-insert update dance (`attachSkillToAgentAction`) are migrated
  to the parameter.
- `link_service.createLink / updateLink / deleteLink` accept
  `branchId`. Create stamps the column. Delete on a main-row-on-
  branch records a `branch_pending_ops` detach (`object_type =
  'note_link'`). Delete on a branch-local row hard-deletes. Delete
  on a row owned by a *different* branch throws — mutating another
  branch's draft is never legal.
- `updateLink` on a branch creates a new branch-local link and
  records a detach pending op for the main row so the promote
  surface reflects the swap.
- `box_object_attachment_repository` gains `branch_id` on the
  `CreateBoxObjectAttachmentInput` shape. `listAttachmentsForBox`
  and `isObjectAttachedToBox` apply `branch_id IS NULL OR = branch`
  filters (main-only readers drop branch rows).
- `attachSkillToBoxAction` and `attachAgentToBoxAction` in
  `src/app/app/boxes/actions.ts` stamp `branch_id =
  ctx.activeBranchId` on the insert; main flow unchanged.
- `detachFromBoxAction` routes:
  * branch-local attachment (`branch_id` = active branch) → hard
    delete in place (no pending op; the row never reached main).
  * main attachment detached from a branch → record a pending
    detach op (object_type='box_object_attachment'), skip the
    existing change_set write-path.
  * other-branch attachment → reject.
- Object-link delete actions (`deleteAgentObjectLinkAction`,
  `deleteSkillObjectLinkAction`, `deleteFileObjectLinkAction`)
  route through `branch_pending_ops` on a branch when the link is
  main-routed; branch-local object_links hard-delete in place.
- Every `createAgentObjectLinkAction` / `createAgentChildFolder` /
  `createAgentChildFile` / Skill sibling call now threads
  `branchId` so the underlying `object_links` row is stamped on
  branch-local child creation.

### Read path

- `listLinksForNote` / `listLinksFromNote` / `listLinksToNote`
  accept a branchId filter. The note detail page, box overview,
  and box page thread `ctx.activeBranchId` into the calls.
- `listAttachmentsForBox` (already called with branchId from the
  tree loader) now filters the underlying query by branch in
  addition to applying placement overrides.

### Promote

`promoteBranch` grew two passes after the existing `object_links`
and `files` promotion:

1. Clear `branch_id` on every `note_links` row matching the branch,
   recording a `change_set_item` with `operation='link_create'`,
   `object_type='note_link'`, `before_snapshot: { branch_id }`,
   `after_snapshot` capturing source / target / relationship_type.
2. Clear `branch_id` on every `box_object_attachments` row matching
   the branch, recording a `change_set_item` with
   `operation='attach'`, `object_type='box_object_attachment'`.

The pending-op pass picks up `detach` intents for `note_link` and
`box_object_attachment` for free via `applyPendingOp`'s existing
detach branch.

### Discard

`discardBranchAction` now hard-deletes branch-local
`note_links` and `box_object_attachments` rows alongside the
existing files / object_links / notes / folders / boxes pass.

### Diff surface

`branch_diff_service.getBranchDiff` gains two fields:

- `createdNoteLinks: CreatedNoteLinkRow[]` — branch-created
  note_links with resolved source / target titles.
- `createdAttachments: CreatedAttachmentRow[]` — branch-created
  box_object_attachments with box and leaf display names.

`branch_detail_client.tsx` renders both as dedicated sections
("New note links" and "New attachments"), and the promote
confirm dialog mentions the counts.

### Tests

- `src/tests/unit/branch_note_links_and_attachments.test.ts` —
  four cases for the note_link repository filter, three for
  `listAttachmentsForBox`, two for `createAttachment`
  branch_id threading, two for `object_link_service.createLink`
  threading.
- `src/tests/unit/branch_note_link_service.test.ts` — five cases
  for `link_service` branch-aware create + delete (stamp,
  main-row-detach-via-pending-op, branch-local-hard-delete,
  cross-branch rejection, main-fallback).

Baseline 377 → 393 tests after the batch.

## v2.0 — Conflict resolution + rebase

When both main and a branch have edited the same object, the branch
detail page previously showed a read-only "main moved ahead" warning
badge with no resolution options. v2.0 closes that gap with three
new services and a resolution UI.

### Conflict detection

`src/server/services/branch_conflict_service.ts` exports
`detectConflicts(supabase, branchId)` which returns a
`BranchConflict[]`. For each `branch_heads` row it compares the
branch version's `parent_version_id` (the fork point) against the
canonical object's `current_version_id` (main's head). When they
differ, and main's head is not the branch head itself, a conflict
exists. The returned struct carries three content snapshots — base
(fork point), main (current), and branch — so the UI can render a
3-way comparison.

### Rebase service

`src/server/services/branch_rebase_service.ts` exports
`rebaseBranch(supabase, branchId, workspaceId, actorId, { strategy })`
with three strategies:

- **`keep_main`**: deletes the `branch_heads` row for each conflicting
  object so promote won't overwrite main's newer work.
- **`keep_branch`** / **`rebase_branch_on_main`**: creates a NEW
  version row whose `parent_version_id` points at main's current head
  and whose content is the branch's content. Updates the branch head
  to point at this new version. The old branch version stays in the
  immutable version chain. This effectively re-anchors the branch on
  top of main.

All strategies record a `branch.rebased` audit event with the
strategy and affected count.

### Server actions

Two new actions in `src/app/app/branches/actions.ts`:

- `detectBranchConflictsAction(branchId)` — read-only, any workspace
  member. Returns `BranchConflict[]`.
- `rebaseBranchAction(branchId, strategy)` — requires write role.
  Validates branch is open.

### UI

The branch detail page (`branch_detail_client.tsx`) now shows:

1. **Conflict banner** at the top when any diff row has
   `mainMovedAhead`. Offers three buttons: "Resolve conflicts"
   (opens the per-object panel), "Rebase on latest main" (opens
   a confirmation dialog), and "Keep my branch as-is" (dismisses
   the warning — the user intends to overwrite on promote).

2. **Per-object conflict resolution panel** with a 3-column layout
   (Base | Main | Branch) for each conflicting object. Bottom
   action bar offers "Keep all from main" / "Keep all from branch" /
   "Rebase all on main".

3. **Pre-promote conflict check**: the Promote button now runs
   `detectBranchConflictsAction` first when conflicts are present.
   If conflicts exist, a dialog warns "N objects have been changed on
   main" with "Resolve first" and "Promote anyway" options.

### Tests

`src/tests/unit/branch_conflict_service.test.ts` — 9 cases:

- No conflict when main hasn't changed
- Conflict detected when main version differs from branch parent
- Empty when branch has no heads
- File head conflict detection through object_versions
- Rebase `rebase_branch_on_main` creates a new version
- Rebase `keep_main` removes the branch head
- Rebase `keep_branch` re-anchors (creates new version)
- No rebased when no conflicts exist
- Throws when branch is not open

Baseline 495 → 504 tests after the batch.

### Branch status state machine

With v2.0 (conflict resolution + rebase) plus the rollback and
"rebase to re-open" paths, the full set of status transitions is:

```
open ──promote──▶ promoting ──┬──▶ promoted ──rollback──▶ rolled_back ──rebase──▶ open
                              │                                                  │
                              └──(failure)──▶ open                               │
                                                                                 │
open ──discard──▶ discarded (terminal)                                           │
                                                                                 │
rolled_back ──rebase──▶ open  ◀──────────────────────────────────────────────────┘
promoted ──rollback──▶ rolled_back
```

Notes on the transitions:

- `open → promoting` uses a CAS (update ... where status = 'open')
  so two concurrent promote calls can't both win.
- `promoting → open` is the failure-recovery path; the promote
  service aborts the change set and flips the status back.
- `promoted → rolled_back` is the user-facing "undo promote" path
  handled by the restore engine. It records a
  `rollback_change_set_id` so the revert is itself reversible.
- `rolled_back → open` is the "rebase to re-open this branch" path
  (v2.0 audit fix): after rebasing a rolled-back branch on main's
  latest state, its status flips back to `open` and it becomes
  re-promotable. A `branch.reopened_via_rebase` audit event is
  recorded alongside the standard `branch.rebased` event.
- `discarded` is terminal. The branch row stays as audit trail;
  there is no path out.

## v2.1 — review workflow

Branches gained a lightweight review gate that sits in front of
`promoteBranch`. The author requests review, reviewers approve or
request changes, and promote is blocked until a branch has either
an explicit approval or the author opts to skip review entirely.

### Schema

Migration `20260414000003_branch_reviews.sql`:

- `draft_branches.review_status text NOT NULL DEFAULT 'draft'` —
  single source of truth read by `promoteBranch`. Values:
  `'draft' | 'review_requested' | 'approved' | 'changes_requested'`.
- `branch_reviews` — one row per submitted review with a
  `superseded_at` timestamp. Re-reviews by the same reviewer stamp
  the prior row superseded rather than mutate it, so history is
  append-only. A partial index
  `branch_reviews_branch_idx WHERE superseded_at IS NULL` backs the
  listReviews read path.
- `branch_comments` — per-diff-row comment threads keyed by
  `(branch_id, object_type, object_id)`. `parent_comment_id` threads
  replies; `resolved` is the source of truth for promote's comment
  gate.

RLS mirrors `folder_branch_overrides` — workspace-member SELECT,
`can_write_workspace` for writes. Comment "only author can delete"
is enforced in the service layer on top of the workspace gate.

### State machine — review_status

```
draft ──request──▶ review_requested
review_requested ──approve──▶ approved
review_requested ──reject──▶ changes_requested
changes_requested ──approve──▶ approved  (subsequent approving review)
approved ──reset──▶ draft                (author reset, no prior reviews)
approved ──reset──▶ review_requested     (author reset, with prior reviews)
```

- `draft` is the pre-review "author going solo" state — promote
  passes. This preserves the previous no-review workflow for
  branches whose authors don't opt into review.
- `approved` passes. One approval is enough; additional approvals
  don't weaken it.
- `review_requested` and `changes_requested` both block promote
  with a clear error surfaced in the UI banner.

### Promote gates

`promoteBranch` now runs two pre-flight gates before the CAS:

1. **Review gate** — rejects `review_requested` and
   `changes_requested`. Not bypassable by `force: true`.
2. **Unresolved-comments gate** — rejects when any
   `branch_comments.resolved = false` row exists for the branch.
   Bypassable via the new `PromoteBranchOptions.force` flag (wired
   admin-only at the action layer).

The existing CAS guard (`open → promoting → promoted`) stays
intact; review gating runs before the CAS so a blocked promote
never transitions the branch status.

### Service layer

- `branch_review_service` — `requestReview`, `submitReview`,
  `listReviews`, `resetReview`. Audit events:
  `branch.review_requested`, `branch.review_approved`,
  `branch.review_changes_requested`, `branch.review_reset`.
- `branch_comment_service` — `createComment`, `listCommentsForBranch`,
  `listCommentsForObject`, `resolveComment`, `unresolveComment`,
  `deleteComment`, `countUnresolvedComments`.
- `branch_service.promoteBranch(supabase, wid, uid, bid, opts?)` —
  signature gained an optional `PromoteBranchOptions` param.

### UI

`src/app/app/branches/[branch_id]/branch_detail_client.tsx`:

- Review status banner (warning / destructive / success palette for
  `review_requested` / `changes_requested` / `approved`).
- Review panel with author-only "Request review" / "Reset after
  edits" buttons and non-author-only "Approve" / "Request changes"
  form with optional note textarea.
- Non-superseded review list with reviewer, decision badge, note,
  timestamp.
- Per-diff-row `CommentThread` component rendered inside every
  expandable `HeadCard`. Supports unresolved + collapsed-resolved
  views, nested replies (1 level of indentation — deeper replies
  roll up visually), and author-only delete.
- Promote button `disabled` and `title` reflect the same gates the
  server enforces.

### Deferred (TODO)

- Auto-`resetReview` inside write hooks. Currently surfaced as an
  explicit "Reset after edits" action; the hook wiring is noted in
  the service comment and will land alongside the next branch-write
  hardening pass.

## v2.3 — cherry-pick / partial promote

Promote is no longer all-or-nothing. The branch detail page now
renders a checkbox in the left gutter of every promote-able card
(heads, Skill / Agent packages, pending ops, folder overrides,
placement changes, note links, attachments, box-metadata
overlays). A toolbar above the diff lets the user "Select all",
"Select none", or "Select changed only". The existing **Promote**
button becomes **Promote all** and is joined by a **Promote
selected (N)** companion that calls a distinct server action and
runs a filtered version of the same promote flow.

### Design

- **Granularity is per-object.** One checkbox per `(objectType,
  objectId)` pair. Selecting a Skill or Agent package selects the
  canonical source, every child file, and every metadata field
  together — cherry-picking inside a package would leave inconsistent
  packages on main, so the package is the atom. Attachment overlays
  have their own identity (`box_object_attachment:<id>`) because
  attachments are first-class objects.
- **Filter at apply time.** `promoteBranch` takes
  `selectedObjects?: Array<{ objectType; objectId }>`. When set, each
  per-overlay loop gates with an `isSelected(type, id)` check before
  writing, recording change-set items, or applying pending ops.
  The extracted helpers (`promoteBoxOverlays`, `promoteFolderOverrides`,
  `promotePlacementOverrides`) gained an optional `filter` predicate
  so the filter decision stays in the caller.
- **Branch stays `open` when work remains.** After a partial promote
  commits, `countUnpromotedForBranch` sums up `branch_heads`, every
  overlay table, unapplied pending ops, and each branch-local leaf
  table. If the total is nonzero the branch flips back to `open` so
  the author can continue editing or promote the rest later. Only
  when the selection covered everything does it land on `promoted`.
- **Change-set origin distinguishes the two paths.** Full-promote
  writes `origin='branch_promotion'`; partial-promote writes
  `origin='branch_promotion_partial'` and records the selection under
  `metadata.promoted_objects`. The `change_sets.origin` CHECK picks
  up the new value in
  `20260414000007_branch_promotion_partial_origin.sql`.
- **Rollback works on both origins.** `branch_rollback_service`
  queries `.in('origin', ['branch_promotion',
  'branch_promotion_partial']) ` ordered by `created_at DESC`, so the
  latest promote (full or partial) is the one "Revert this
  promotion" undoes. The existing status gate still requires
  `status='promoted'` for rollback via the button — a partially
  promoted branch that's still `open` has no "revert" button since
  reverting a partial while the author keeps editing would conflict
  with further writes.

### Service

`src/server/services/branch_service.ts`:

- `PromoteBranchOptions.selectedObjects?: ReadonlyArray<{ objectType;
  objectId }>` — undefined runs the full path; a non-empty array
  runs the cherry-pick path; an empty array is rejected with a
  clear error.
- `countUnpromotedForBranch(supabase, branchId)` — new helper used
  after partial promote to decide the final branch status.
- The package metadata, branch-local files / object_links /
  note_links / attachments / notes / folders / boxes loops, and the
  pending-ops loop each gained an `isSelected(...)` gate.

### Action

`src/app/app/branches/actions.ts`:

- `partialPromoteBranchAction(branchId, selectedObjects)` — validates
  the selection is non-empty and well-shaped, delegates to
  `promoteBranch`, re-reads the branch to see whether it flipped to
  `promoted`, writes a `branch.partial_promoted` audit event, and
  only clears the active-branch cookie when nothing is left to
  promote.

### UI

`src/app/app/branches/[branch_id]/branch_detail_client.tsx`:

- `SelectionContext` lives alongside `CommentsContext`. Seeded only
  for open branches + write-capable callers; nullable otherwise so
  viewers and closed branches render without checkboxes.
- `SelectionCheckbox` renders one checkbox per selectable card.
  `onClick` stops propagation so the checkbox doesn't toggle the
  expandable parent card.
- Selection toolbar above the diff surfaces count + "Select all /
  none / changed only" buttons.
- The partial-promote confirmation dialog lists the selected
  objects by resolved display name so the author can spot-check
  before confirming.

### Tests

`src/tests/unit/branch_partial_promote.test.ts` (10 cases):

- Selection filter actually skips unselected heads.
- Change-set origin + metadata for partial vs full paths.
- Branch status stays `open` with remaining work; flips to
  `promoted` when the selection covers everything.
- Pending ops on unselected objects are preserved.
- Empty selection is rejected.
- Overlay helpers receive a filter predicate under partial, none
  under full.
- Rollback query uses `.in(origin, [...both])` so partial promote
  change sets are eligible for the "Revert this promotion" flow.

## v2.2 — Branch lifecycle + auto-cleanup

Workspaces accumulate draft branches forever by default — including
AI-authored branches from MCP sessions that never come back to
promote or discard. v2.2 adds an opt-in retention policy and the
machinery to warn authors and auto-discard branches that have been
idle past a configurable threshold.

### Schema

`20260414000004_branch_lifecycle.sql`:

- `workspace_branch_retention_policies` — one row per workspace that
  has opted in. Columns: `enabled` (defaults false),
  `warn_after_idle_days` (default 30), `auto_discard_after_days`
  (default 60), `updated_by`. A table-level CHECK enforces
  `auto >= warn` at the DB level so the invariant isn't app-only.
- RLS mirrors the workspace_memberships pattern: any member can
  SELECT, only admins (`can_admin_workspace(wid)`) can INSERT /
  UPDATE / DELETE.
- `draft_branches.last_activity_at` — `timestamptz` nullable,
  backfilled to `GREATEST(updated_at, created_at)` for existing
  rows.
- `draft_branches.last_warned_at`, `draft_branches.warning_count` —
  bookkeeping for the warning loop.
- Composite index `draft_branches_last_activity_idx` on
  `(workspace_id, status, last_activity_at)` so the stale-scan is a
  cheap range over open branches in one workspace.

### Service

`branch_lifecycle_service` exposes:

- `getRetentionPolicy(ws)` — stored row or a disabled default.
- `setRetentionPolicy(ws, actor, patch)` — upsert. Validates
  `auto >= warn` and positive days. Admin gating lives in the
  action layer, not the service — the cron endpoint reuses the
  service with a platform-level secret.
- `touchBranchActivity(branchId)` — stamps `last_activity_at = now()`
  on the branch. Called from every branch-local write seam.
- `listStaleBranches(ws, { idleDays })` — open branches whose
  `last_activity_at` (or `created_at` fallback) is older than the
  cutoff. Sorted most-stale first.
- `warnStaleBranches(ws)` — warns stale-past-threshold branches that
  haven't been warned in the cooldown window (warn window / 3,
  min 1d). Caps at `MAX_WARNING_COUNT` (2) warnings per branch.
  Emits `branch.stale_warned` audit per warned branch.
- `autoDiscardExpiredBranches(ws)` — discards stale-past-auto
  branches that have at least one prior warning. Runs the full
  discard cleanup (matches the user-facing `discardBranchAction`
  path). Emits `branch.auto_discarded` audit.
- `dismissStaleWarning(branchId)` — user action "keep this branch
  active"; zeroes the warning and touches activity.

### Integration — touch points

`touchBranchActivity` is invoked at the common write seams so every
branch-aware edit path feeds the same activity timestamp:

- `upsertBranchHead` — every content edit (notes, files, skills,
  agents).
- `recordPendingOp` — trash / archive / unarchive / move / detach.
- `upsertFolderOverride`, `upsertPlacementOverride`.
- `upsertBoxMetadataOverlay`, `upsertPackageMetadataOverlay`.

Each call is wrapped in try/catch so a rare lifecycle-table failure
never blocks the user's write.

### UI

- `/app/settings/workspace/branch_retention` — admin surface with
  an editable policy card + a stale-branch panel that exposes
  per-row "Dismiss" / "Discard now" and a bulk "Run cleanup now"
  action for admins. Any member can view; only admins can save.
- `/app/branches` — each open branch whose `last_warned_at` is
  within the last 7d renders a dimmed "Stale — will auto-discard
  in X days" indicator under the head count.
- Branch detail page — same-criteria branches show one additional
  banner above the Promoted / rolled-back banners, with two
  actions: "Keep active" (touches activity + clears warning) and
  "Discard now" (opens the canonical discard confirm dialog).

### Background runner

`POST /api/internal/branch_cleanup` — authenticated via a bearer
token stored in `BRANCH_CLEANUP_CRON_TOKEN`. Iterates every
workspace with `enabled = true` and runs `warnStaleBranches` +
`autoDiscardExpiredBranches` against each. Returns
`{ ok, workspaces, warned, discarded }`.

Wiring for Vercel Cron (the endpoint itself ships; the cron config
does not):

```json
{
  "crons": [
    { "path": "/api/internal/branch_cleanup", "schedule": "0 * * * *" }
  ]
}
```

Any external cron (cron-job.org, systemd timer, GitHub Action, etc.)
that can POST with the bearer token set in the env var will also
work. The endpoint is idempotent — warn cooldown and
warning-gated auto-discard keep repeated calls from over-acting.

### Audit events

- `branch.stale_warned` — per warn tick. Metadata includes
  `warning_count`, `days_idle`, `warn_after_idle_days`,
  `auto_discard_after_days`.
- `branch.auto_discarded` — per auto-discard. Metadata includes
  `days_idle`, `warning_count`, `auto_discard_after_days`, `name`.
- `branch.retention_policy_updated` — admin saved a new policy.
- `branch.cleanup_run` — admin pressed "Run cleanup now".
- `branch.stale_warning_dismissed` — user pressed "Keep active" on
  a warned branch.

## Related docs

- [branch_aware_writes_v1.md](branch_aware_writes_v1.md)
- [branch_local_sort_order_and_reorder_isolation_v1.md](branch_local_sort_order_and_reorder_isolation_v1.md)
- [package_branch_state_for_skills_and_agents_v1.md](package_branch_state_for_skills_and_agents_v1.md)
- [rollback_schema_and_restore_engine_v1.md](rollback_schema_and_restore_engine_v1.md)
- [branch_rls_hardening_v1.md](branch_rls_hardening_v1.md) — RLS
  branch-access clause and zero-UUID CHECKs covering the `branch_id`
  columns introduced here.
