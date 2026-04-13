# Rollback schema and restore engine — v1

This document is the concrete state of the rollback architecture after
the schema + engine pass. It complements
[`docs/rollback_architecture_v1.md`](rollback_architecture_v1.md)
(the conceptual model) with an implementation-focused walkthrough of
what actually exists in the repo now.

## Schema recap

Every rollback table lives in
`supabase/migrations/20260412000004_rollback_foundations.sql` with RLS
tightened by `20260412000005_rls_write_role_gate.sql`:

* `change_sets` — grouped mutation handle. Origins: `manual_edit`,
  `import`, `proposal_approval`, `structural_move`, `lifecycle`,
  `rollback`, `restore`, `branch_promotion`, `system`. Status:
  `open` → `committed | aborted`.
* `change_set_items` — immutable per-object record. Operation:
  `create | update | archive | unarchive | trash | restore_lifecycle
  | move | attach | detach | link_create | link_delete | rollback`.
  Carries `before_snapshot` + `after_snapshot` jsonb + optional
  `version_id`.
* `structural_events` — tree-shape events with explicit
  `before_state` / `after_state` jsonb and a `sequence` ordinal so the
  restore engine can replay LIFO. Event types: `move`, `reorder`,
  `folder_rename`, `path_cascade`, `attach`, `detach`,
  `folder_create`, `folder_delete`.
* `draft_branches` + `branch_heads` — schema-only foundation for
  exploratory editing. Not yet wired into writes; the types and
  resolver exist.
* `restore_records` — one row per restore operation. Scope:
  `version | change_set | structural | import`. Links source change
  set → restored change set.
* Nullable `change_set_id` on `audit_events`, `note_versions`,
  `object_versions`, and `write_proposals` closes the correlation
  loop — every durable mutation can be traced back to the change set
  that produced it.

## Services — what they do now

### `change_set_service.ts`

CRUD primitives plus pure inverse helpers. `openChangeSet`,
`commitChangeSet`, `abortChangeSet` (all CAS-guarded on status),
`recordChangeSetItem`, `recordStructuralEvent` (auto-sequences within
a change set), `listChangeSetsForWorkspace`, `listChangeSetItems`,
`listStructuralEvents`. `inverseOperation` and
`inverseStructuralEvent` are pure functions used by the planner.

### `restore_service.ts`

The restore engine. Public surface:

* `planRestoreFromChangeSet(changeSetId)` — read-only preview. Returns
  `RestorePlan { items, structural, blockers }`. Blockers fire for
  aborted change sets, missing `before_snapshot` on updates, and
  incomplete folder-move snapshots.
* `restoreFromChangeSet(workspaceId, actorId, changeSetId)` — opens a
  child change set (`origin: 'restore'`,
  `parent_change_set_id = source`), replays structural events LIFO,
  replays content items in reverse creation order, writes a
  `restore_records` row with `status: applied | failed`.
* `restoreNoteVersion(workspaceId, actorId, noteId, versionId)` —
  single-note rollback wrapper. Wraps the existing
  `rollbackNoteToVersion` RPC in a `rollback`-origin change set and
  tags the new version row with `change_set_id`.
* `restoreObjectVersion(workspaceId, actorId, objectType, objectId,
  versionId)` — the file / skill / agent parallel. Same wrapping
  pattern against `rollbackObjectToVersion`.

Structural inverse executor handles every event type listed above.
`folder_create` inverse soft-trashes both the folder and its
`workspace_objects` registry row; `folder_delete` inverse rebuilds
the folder from the event's `before_state` snapshot. Both now run
without throwing on the standard shape.

### `change_set_metadata_service.ts` (new)

The metadata surface the UI layer will consume:

* `summarizeRestoreCandidate(changeSetId)` — one-call snapshot
  combining the raw change set, its items, its structural events,
  and the planner's output into a single render-friendly
  `RestoreCandidateSummary`. Includes `canRestore` and `blockers`
  for the confirm-dialog path.
* `compareVersionToCurrent(objectType, objectId, baselineVersionId)` —
  pre-rollback diff. Diffs title / markdown / summary / tags for
  notes, and source_content for files / skills / agents. Used by the
  History UI to render a "here's what this rollback will change"
  summary before confirming.
* `compareChangeSetToCurrent(changeSetId)` — per-object "dirtyAfter"
  flag so the UI can warn when restoring will overwrite edits made
  after the change set committed.

### `lifecycle_change_set.ts` (new)

`withLifecycleChangeSet(supabase, args, perform)` — wraps an archive
/ unarchive / trash / restore_lifecycle transition in a change set
with full before/after `status` snapshots. The lifecycle service keeps
running all its own guards; this wrapper is pure bookkeeping. Wired
today into the note lifecycle actions; folders / files / skills /
agents / boxes use the same pattern — the helper is generic so they
adopt it without further changes.

### `branch_service.ts`

Unchanged from the foundation pass — CRUD + `resolveBranchVersion`.
Schema-only until the editor pipeline is refactored to be branch-aware.

## Integration points (where change sets get written)

| Surface | File | Origin |
|---|---|---|
| Import | `src/app/app/import_export/actions.ts` | `import` — one item per created/replaced object; `folder_create` structural events for created folders |
| Proposal approval | `src/server/services/write_proposal_service.ts` | `proposal_approval` — one item per approved object, `change_set_id` back-linked onto `write_proposals` |
| Tree drag/drop | `src/app/app/boxes/actions.ts` `moveTreeNodeAction` | `structural_move` — move event + `path_cascade` events for every descendant |
| Folder create | `src/app/app/boxes/actions.ts` `createFolderAction` | `manual_edit` — item + `folder_create` event |
| Attach (skill/agent) | `src/app/app/boxes/actions.ts` `attachSkillToBoxAction` / `attachAgentToBoxAction` | `structural_move` — `attach` event |
| Detach | `src/app/app/boxes/actions.ts` `detachFromBoxAction` | `structural_move` — `detach` event with prior row snapshot |
| Lifecycle (notes) | `src/app/app/notes/[note_id]/actions.ts` | `lifecycle` — item with before/after status |
| Rollback (note / object) | `restore_service.ts` | `rollback` — item + version_id tag |

Every item, structural event, and restore_records row is attributable
back to the originating actor, which preserves the rollback
architecture's attribution contract.

## What the restore engine can do today

Supported end-to-end:

1. Restore a **note** to a prior version (`restoreNoteVersion`).
2. Restore a **file** to a prior version (`restoreObjectVersion`).
3. Restore a **skill** canonical source version.
4. Restore a **agent** canonical source version.
5. Restore a **grouped import** as one operation — every
   item-created object is lifecycle-restored via its inverse
   (`create → trash`), every folder_create is soft-trashed.
6. Restore a **tree move / reorder** change set — reverses
   `folder_id` and `sort_order` on the dragged node and replays the
   LIFO sequence of `path_cascade` events across descendants.
7. Restore an **attach / detach** change set — detach reinserts the
   attachment row from the snapshot; attach deletes it.
8. Restore a **lifecycle transition** — `archive → unarchive`, etc.
9. Restore a **proposal approval** — writes a new version on the
   affected object reverting to the pre-approval state.

## Invariants honored

* **No mutation of history.** Every restore opens a new change set
  and writes new rows. `note_versions` / `object_versions` are never
  updated; only the canonical object's `current_version_id` advances.
* **Stable identity.** Restores do not change object ids.
  `path_cache` is recomputed on folder moves but is explicitly a
  convenience field, never identity.
* **Audit append-only.** Every grant, restore, rollback writes a new
  `audit_events` row. No updates.
* **No silent forking of reusable shared objects.** Restoring a
  reusable skill/agent writes a new version on the canonical row,
  not a branch copy. Promotion through draft branches is an explicit
  separate action.
* **No orphaned topology.** Restores that would create a folder
  cycle or an invalid parent are caught by `planRestoreFromChangeSet`
  as blockers before any writes land.
* **Import restore is all-or-nothing.** Folder and leaf rows from the
  same import share one change_set; the executor walks the whole
  set before declaring success.

## Test coverage

* `src/tests/unit/rollback_foundations.test.ts` — 24 pure-primitive
  tests (inverse contracts, planner blockers, folder inverse).
* `src/tests/integration/restore_engine.test.ts` (new) — 9 tests
  exercising `restoreNoteVersion`, `restoreObjectVersion`
  (file / skill / agent parameterised), aborted-change-set blocker,
  missing-change-set handling, and inverse-contract stability.

Full suite: 259 / 259 passing.

## Follow-ups landed (v1.3)

### Full lifecycle wrapping coverage

Every lifecycle action across the product now routes through
`withLifecycleChangeSet`:

| Surface | File |
|---|---|
| Notes | `src/app/app/notes/[note_id]/actions.ts` |
| Folders + boxes | `src/app/app/boxes/[box_id]/actions.ts` |
| Files | `src/app/app/files/lifecycle_actions.ts` |
| Skills | `src/app/app/skills/lifecycle_actions.ts` |
| Agents | `src/app/app/agents/lifecycle_actions.ts` |

Every archive / unarchive / trash / restore transition writes a
`change_set_item` with before/after `status` and is restorable via
`restoreFromChangeSet`.

### Partial restore within a change set

`restoreFromChangeSet(workspaceId, actorId, changeSetId, filter?)`
accepts an optional `RestoreScopeFilter { itemIds?, eventIds? }`. A
populated filter narrows the inverse pass to the chosen items /
events; the planner blockers still apply to the chosen subset.

The History confirm dialog lets users deselect items via checkboxes;
the client passes the resulting `itemIds` through. The full-restore
path (no filter) stays the default.

### Cross-change-set compensating restore

`restoreManyChangeSets(workspaceId, actorId, sources)` takes an
ordered list of `{ changeSetId, filter? }` and wraps every per-source
restore under a single bracketing `origin: 'restore'` change set with
`metadata.batch: true`. Children's `parent_change_set_id` is rewritten
to point at the bracket so a history renderer can collapse them into
one row. Failure semantics are best-effort per source; the bracket
commits iff at least one child succeeded.

### Enhanced confirm dialog

The `/app/history` detail drawer now consumes the new metadata
surface:

- `summarizeRestoreCandidate` produces a `RestoreCandidateSummary`
  embedded in the detail fetch so the UI can render blockers,
  affected-object counts, and display hints in one shot.
- `compareChangeSetToCurrent` flags `dirtyAfter` per object. The
  detail row shows an "edited since" badge next to any item whose
  target has been modified since the change set committed.
- The confirm dialog surfaces an explicit "will overwrite newer
  edits" banner when any selected item is `dirtyAfter`.
- The detail body renders per-item checkboxes so partial restore is
  a one-click action.

## Follow-ups landed (v1.4)

### Branch-aware writes (notes)

Draft branches now carry real write semantics.
`updateNoteOnBranch(supabase, userId, workspaceId, branchId,
noteId, …)` writes a new immutable `note_versions` row and upserts
the branch's `branch_heads` pointer, without touching the canonical
`notes` row. `getNoteForWorkspace` accepts an optional branch id
and patches `title` / `markdown_content` / `current_version_id`
from the branch head when one exists. `saveNoteAction` routes to
the branch path whenever `ctx.activeBranchId` is set.

Promote (`promoteBranch` / `promoteBranchAction`) walks every
branch head and advances main's `current_version_id` to the branch
version inside a single `origin: 'branch_promotion'` change set —
restoreable end-to-end. Discard marks the branch discarded and
clears the active-branch cookie if it was set. Both actions are
role-gated.

UI: `/app/branches` lists every branch with head counts, active
indicator, switch/promote/discard buttons, and a "New branch"
dialog. Sidebar nav link `Branches` opens it.

Full design in
[`docs/branch_aware_writes_v1.md`](branch_aware_writes_v1.md).

### Follow-ups landed (v1.6): package-aware branching for Skills and Agents

`branch_package_metadata` overlay table (migration
`20260412000007_branch_package_metadata.sql`) records
per-(branch, package) metadata overrides for Skills and Agents.
`promoteBranch` applies the overlay onto the canonical
`skills` / `agents` row as part of the same
`origin: 'branch_promotion'` change set, recording a
`change_set_item` with before/after `metadata` snapshots.
Restoring the promotion reverts metadata to main's prior values
through the normal restore path — no new restore logic.

The branch diff service groups child-file heads under their parent
Skill / Agent package via `files.parent_skill_id` /
`files.parent_agent_id`, so `/app/branches/[id]` renders coherent
package cards instead of a flat head list. No new persistence for
membership; parent pointers are already canonical.

Out of scope in this release: structural adds / removes on branch
(new-object creation still lands on main), child folder branching,
Agent → Skill reference branching.

### Follow-ups landed (v1.5): branch-aware writes for files / skills / agents

`updateObjectContentOnBranch` (in
`src/server/services/object_branch_service.ts`) is the shared branch
write helper for files / skills / agents. Service-level wrappers —
`updateFileContentOnBranch`, `updateSkillContentOnBranch`,
`updateAgentContentOnBranch` — expose it as the same shape
`updateNoteOnBranch` offers for notes. Reads likewise accept a
`branchId` across `getFileForWorkspace`, `getSkillForWorkspace`,
`getAgentForWorkspace` and patch `source_content` / `content_bytes`
/ `current_version_id` when a branch head exists, falling through
to main otherwise.

`promoteBranch` now dispatches on `object_type`: notes use
`note_versions` + the `notes` row; files / skills / agents share
`object_versions` + their canonical table. Every promoted version
is tagged with `change_set_id` so the rollback engine traces
`branch_promotion → versions`. Restoring a promotion change set
reverses the pointer moves across all object types uniformly.

## Intentionally deferred (not TODOs)
* **History timeline UI** beyond `/app/history`. The metadata surface
  is already wired; richer surfaces (graph view, cross-user filter)
  are layered surfaces that don't require engine changes.
* **Streaming / virtualised very-large change-set detail rendering.**
  Typical change sets have tens of items; imports might touch hundreds.
  Current non-virtualised list is fine at those sizes; a change set
  with >1k items would need windowing, which is a pure client
  concern.
* **Three-way merge for branches.** Context Store uses promote /
  discard as its resolution mechanism, not merge. A branch whose main
  head advanced ahead of promote simply overwrites those main changes
  — the restore engine catches them as `dirtyAfter` warnings on the
  promotion change set. Three-way merge semantics aren't on the
  roadmap.

## v1.7 — Placement promotions land as `move` / `update` items

Promote now also iterates `branch_placement_overrides` and writes
each overlay back to the canonical `workspace_objects` /
`box_object_attachments` row. Each promoted overlay produces a
`change_set_item` whose `operation` is `'move'` when the overlay
changed `folder_id` and `'update'` when only `sort_order`
changed. `before_snapshot` carries the canonical pre-state plus
`branch_id`; `after_snapshot` carries the overlay's effective
fields plus `promoted_from_branch`. Restores of placement
promotions flow through the existing `update`-arm of the engine
unchanged — the snapshots have everything the planner needs to
revert sort + folder back to the canonical pre-state.

See [`docs/branch_local_sort_order_and_reorder_isolation_v1.md`](branch_local_sort_order_and_reorder_isolation_v1.md).

## Referenced docs

* [`docs/rollback_architecture_v1.md`](rollback_architecture_v1.md) — conceptual model
* [`docs/version_history_v1.md`](version_history_v1.md) — immutable version graph
* [`docs/machine_write_v1.md`](machine_write_v1.md) — proposals as change sets
* [`docs/lifecycle_controls_v1.md`](lifecycle_controls_v1.md) — lifecycle transitions are restorable
* [`docs/import_export_v1.md`](import_export_v1.md) — imports as grouped restore units
* [`docs/branch_local_sort_order_and_reorder_isolation_v1.md`](branch_local_sort_order_and_reorder_isolation_v1.md) — placement overlay
