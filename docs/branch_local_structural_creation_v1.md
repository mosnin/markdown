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

## Related docs

- [branch_aware_writes_v1.md](branch_aware_writes_v1.md)
- [package_branch_state_for_skills_and_agents_v1.md](package_branch_state_for_skills_and_agents_v1.md)
- [rollback_schema_and_restore_engine_v1.md](rollback_schema_and_restore_engine_v1.md)
