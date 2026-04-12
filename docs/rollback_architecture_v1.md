# Rollback and restoration architecture — v1

Context Store is a structured context operating system. Its users — human and
machine — depend on being able to return to a known good state. This document
is the architecture of how that happens, at the level of the data model.

The design is deliberately **Git-inspired without being Git**. We reuse
the immutable-graph and named-branch trust ideas that make Git
dependable; we reject the raw source-control metaphors that would make
Context Store harder to reason about as a context system.

## Objectives

1. **Every mutation is reversible.** Version-bearing content (notes,
   files, skills, agents), tree shape (moves, reorders, folder
   cascades), lifecycle transitions (archive, trash, restore), and
   group operations (imports, proposal approvals) can all be returned
   to a prior state.

2. **Every mutation is attributable.** Every change set carries an
   actor (human user id, connection id, or `system`). Restore inherits
   that accountability chain by recording a `parent_change_set_id`
   link back to the change set being undone.

3. **History never mutates.** Restores write **new** state. Past
   versions, audit rows, and change-set items are immutable. Undoing a
   restore walks back up the lineage chain — it does not delete the
   restore.

4. **Reusable objects do not silently fork.** Restoring a reusable
   skill or agent writes a new version on the canonical row, not a
   divergent copy. Branching is an explicit, separate user action
   (draft branches; see §5).

5. **Structural restores never produce invalid topology.** Folders
   cannot be moved into their own descendants, leaves cannot orphan,
   and path_cache is always re-derived from folder + slug on restore.

## Concepts introduced

| Concept              | Table                 | Purpose                                               |
|----------------------|-----------------------|-------------------------------------------------------|
| Change set           | `change_sets`         | Group handle for any mutation, simple or batched.     |
| Change set item      | `change_set_items`    | Per-object record inside a change set. Immutable.     |
| Structural event     | `structural_events`   | Per-tree-mutation record (move, reorder, …) on a change set. |
| Draft branch         | `draft_branches`      | Named handle for exploratory editing.                 |
| Branch head          | `branch_heads`        | Per-object pointer to the branch's visible version.   |
| Restore record       | `restore_records`     | Audit of a restore action (source → produced).        |

Plus nullable `change_set_id` columns added to `audit_events`,
`note_versions`, `object_versions`, and `write_proposals`, so every
existing row can be correlated to the change set that produced it.

See migration `supabase/migrations/20260412000004_rollback_foundations.sql`
for the full schema definition and RLS.

## Change set model

A **change set** is the atomic unit of rollback. Every write that
should be reversible as one is wrapped in one. Services open a change
set, accrue items and structural events, and finalize.

```
open → (committed | aborted)
```

Status transitions are guarded by a table-level CHECK constraint:

* `open` means the service is still writing to it.
* `committed` means the write is durable and observers should consider
  the group complete.
* `aborted` means the change set wrote nothing material; readers should
  ignore it. Abort is idempotent.

**Origins** classify the trigger so the restore planner can pick the
right undo semantics. V1 origins: `manual_edit`, `import`,
`proposal_approval`, `structural_move`, `lifecycle`, `rollback`,
`restore`, `branch_promotion`, `system`. New origins are added
additively.

**Lineage.** `parent_change_set_id` points at the change set this one
was derived from. A `restore` change set points back at the change set
it is undoing. A `branch_promotion` points back at the draft change
set that sourced the promotion. Lineage is traversable — "restore of
restore of import" walks back to the original import.

## Version graph

Content-bearing objects already had immutable version history prior to
this work. Rollback builds on that:

* `note_versions` + `object_versions` carry `parent_version_id`
  forming a linked list per object.
* `change_origin` classifies how the version came to be (`human_edit`,
  `import`, `generated`, `proposal_approved`, `rollback`).
* Rollback never mutates a version; it writes a new version whose
  `parent_version_id` is the current head and whose content mirrors
  the target historical version.
* **New:** every version row now has a `change_set_id` pointing at the
  change set that created it. This lets us walk from "change set" →
  "versions" and from "version" → "enclosing change set" in either
  direction.

Merge semantics are deliberately **not** in V1. The graph supports
them (parent pointers could diverge under a branch), but the service
layer only writes linear chains on the main branch. Draft branches
have their own heads in `branch_heads`.

## Structural rollback model

Tree-shape mutations have no version table of their own. Instead, every
such mutation records a `structural_events` row on the owning change
set. The row carries a full before / after snapshot: `folder_id`,
`parent_folder_id`, `sort_order`, `path_cache`, `box_id`.

The restore service replays these events **in reverse sequence order**.
For each event the inverse is `{ event_type, before ↔ after }`; applied
back to the canonical tables it rebuilds the prior topology.

Invariants enforced at plan time (no DB writes yet):

* A folder move whose `after_state` lacks `path_cache` is marked
  `blocked` — we never attempt a folder move without a destination
  path.
* `folder_create` / `folder_delete` inverses raise at execute time in
  V1 so the system never half-executes a structural restore when those
  events appear; services that emit them are expected to extend the
  executor before shipping a user-facing restore surface.

## Draft branch foundation

`draft_branches` + `branch_heads` land in this migration as schema +
minimal CRUD service only. The intent: a user can create a named track
for risky or exploratory edits, write to it without disturbing main,
and either promote the diff or discard it. Promotion is a restore-style
operation that copies each branch head onto the canonical
`current_version_id`.

V1 scope: schema, create / list / discard / promote status hooks, head
upserts, and a `resolveBranchVersion` helper that the editor layer can
eventually call to read through the branch.

Out of scope for V1: branch-aware write paths in the existing edit
actions, diff + compare UI, conflict resolution when main has moved
ahead of the branch. The schema is forward-compatible with those.

## How imports participate

`importPackageAction` now opens a change set of origin `import` before
calling `importPackage`. After the service returns, each
`ImportAction` with a `final_id` is recorded as a `change_set_item`:

* `created` → `operation: "create"` item
* `replaced` / `remapped` → `operation: "update"` item with a
  `final_path` hint in `after_snapshot`
* `skipped` / `duplicated` → no item (no material change)

The change set commits on success and aborts on thrown errors. The
returned `ImportSummaryReport` now carries `change_set_id` so callers
can surface "Undo this import" directly. Restoring an import change set
undoes every created / replaced object as one atomic operation.

## How proposal approvals participate

`approveProposal` now opens a change set of origin `proposal_approval`
around the approval RPCs. The change set's actor is the approving
human (`actor_type: 'user'`); the originating connection id lives in
`metadata`, preserving both sides of the attribution chain.

* Approved outcome → one `change_set_item` pointing at the affected
  note / file / skill / agent, with `version_id` when available and
  `proposal_id` in `after_snapshot`.
* Conflicted outcome → change set is aborted, nothing durable written.
* The proposal row itself gets a `change_set_id` back-reference so a
  restore can find it again.

## How manual writes participate

The structural drag-and-drop path (`moveTreeNodeAction`) opens a
`structural_move` change set, captures before-state snapshots of
`workspace_objects`, `box_object_attachments`, and `folders`, applies
the move, and then records a `move` structural event with full
before / after state. The change set commits on success; an error
aborts it before any audit observers believe in the group.

Note rollback (`rollbackNoteToVersion`) is unchanged on the inside.
The new `restoreNoteVersion` wrapper in `restore_service.ts` invokes
it inside an `origin: 'rollback'` change set and tags the resulting
version row with the change set id.

## Restore service

`src/server/services/restore_service.ts` exposes:

* `planRestoreFromChangeSet(supabase, changeSetId)` — builds a
  `RestorePlan` without touching data; surfaces blockers.
* `restoreFromChangeSet(supabase, workspaceId, actorId, changeSetId)` —
  opens a child change set (`origin: 'restore'`,
  `parent_change_set_id` = source), undoes structural events in reverse
  sequence, undoes content items in reverse creation order, and records
  a `restore_records` row on success or failure.
* `restoreNoteVersion(supabase, workspaceId, actorId, noteId,
  versionId)` — targeted single-version rollback wrapped in its own
  change set.

The planner refuses to run if:

* The source change set is `aborted`.
* An update item has no `before_snapshot` (no safe undo possible).
* A structural event's inverse has no destination `path_cache` where
  one is required.

The executor aborts the child change set and writes a `failed` restore
record on the first unrecoverable error. Nothing is ever left in a
half-applied state.

## Trust invariants (enforced or stated)

| Invariant                                                                 | Where enforced                                                         |
|---------------------------------------------------------------------------|------------------------------------------------------------------------|
| Versions are immutable                                                    | `note_versions` / `object_versions` RLS — no UPDATE / DELETE policy.   |
| Audit is append-only                                                      | `audit_events` has no UPDATE / DELETE policy.                          |
| Change set items are immutable                                            | `change_set_items` policy permits INSERT only.                         |
| Change sets move monotonically                                            | Table CHECK on `status` / timestamps; CAS update in service.           |
| Restore creates new state (never mutates history)                         | Restore service always opens a child change set.                       |
| Folder cannot land in its descendant on restore                           | `isFolderCycle` + `inverseStructuralEvent` before writes.              |
| Reusable skills / agents do not silently fork during restore              | Restore writes a new version on the canonical row, not a branch copy. |
| Import restore undoes all affected objects as one operation               | `importPackageAction` records one item per created/replaced object.    |
| Proposal-approval restore undoes the proposal atomically                  | `approveProposal` writes the item inside the same change set.          |
| Move events without a destination path_cache are refused                  | `planStructural` blockers.                                             |
| Structural restores apply in LIFO order                                   | `restoreFromChangeSet` reverses the structural sequence.               |
| Every version / audit / proposal row can be correlated to its change set  | New `change_set_id` FK columns.                                        |

## What is implemented now vs. later

**In this migration:**

* Schema, RLS, and indexes for every new table.
* Change set service (open / commit / abort / record item / record
  structural / list).
* Restore service (plan + execute from change set; wrapped note
  rollback).
* Draft branch service (CRUD + head upsert + branch version resolver).
* Wiring: `importPackageAction`, `approveProposal`, and
  `moveTreeNodeAction` all open, populate, and finalize change sets.
* Unit tests for the planner primitives and inverse contracts
  (`src/tests/unit/rollback_foundations.test.ts`).

**Explicitly deferred (out of scope for this prompt):**

* Human UI: history timeline, "Undo this import" button, draft-branch
  compare view. All of these can be layered on top of the existing
  data without further migrations.
* Branch-aware read/write in the existing edit actions. The schema and
  resolver are present; the editor layer doesn't consult a branch yet.
* Merge semantics across branches. The graph allows divergent heads;
  V1 only writes linear chains on main.
* `folder_create` / `folder_delete` structural inverses. The executor
  refuses these intentionally so the feature never silently
  half-executes. The next iteration adds a safe implementation.
* Per-box / per-folder permissions on restore. V1 uses the
  workspace-level role model (`require_role.ts`); only workspace
  members can view change sets, and restore is a write operation gated
  by `canWrite`.

## Related documents

* `docs/version_history_v1.md` — the pre-existing immutable version
  graph; unchanged semantics, extended with `change_set_id`.
* `docs/machine_write_v1.md` — proposal approval now always runs
  inside a change set.
* `docs/lifecycle_controls_v1.md` — lifecycle status transitions can
  now be restored via `change_set_items` with `operation: archive |
  unarchive | trash | restore_lifecycle`.
* `docs/auth_and_permissions.md` — restore is a write operation;
  viewers cannot restore.
