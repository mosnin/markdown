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

Full suite: **306 / 306 passing**.

## What's branch-aware now vs. still on main

| Operation                             | Branch-aware? |
|---------------------------------------|:-------------:|
| Edit an existing file's source        | ✅            |
| Edit a Skill/Agent canonical source   | ✅            |
| Edit Skill/Agent metadata             | ✅ (overlay)  |
| **Create a new child file**           | ✅            |
| **Attach Skill → Agent**              | ✅            |
| Detach Skill from Agent               | ❌            |
| Move file between folders on branch   | ❌            |
| Create / move / trash folders         | ❌            |
| Trash a file on branch                | ❌            |

## Out of scope

- **Detach / trash / move** on a branch still mutate main. Closing
  these needs a "soft-delete on branch" or "move-intent" concept
  which this pass deliberately skips.
- **Child folder branching.** Folders aren't versioned; independent
  design required.
- **Branch-aware creation of notes / folders / boxes.** Only files
  + object_links have the `branch_id` column today; extending
  further means more tables get the treatment.

## Related docs

- [branch_aware_writes_v1.md](branch_aware_writes_v1.md)
- [package_branch_state_for_skills_and_agents_v1.md](package_branch_state_for_skills_and_agents_v1.md)
- [rollback_schema_and_restore_engine_v1.md](rollback_schema_and_restore_engine_v1.md)
