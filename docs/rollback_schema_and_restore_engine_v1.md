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

## Intentionally deferred (not TODOs)

* **Branch-aware writes.** Editor actions don't consult `branch_heads`
  yet. Adding requires threading a branch id through every mutation
  and a UI for selecting branches. Schema + resolver are ready.
* **Full lifecycle change-set wrapping for folders / files / skills /
  agents / boxes.** The `withLifecycleChangeSet` helper is generic;
  notes are wired as the reference. The remaining object types adopt
  the same pattern without code changes to the helper.
* **History timeline UI** beyond `/app/history`. The metadata surface
  (`summarizeRestoreCandidate`, `compareVersionToCurrent`) is ready
  for richer renderings.
* **Partial restore** (restore some items from a change set, skip
  others). The current engine is all-or-nothing inside a change set —
  the right semantic for grouped operations like imports. Finer
  granularity would need per-item restore planning, which the
  planner's shape can already accommodate.
* **Batch compensating change sets.** Individual compensating items
  can already be authored manually; the engine doesn't offer a
  helper for "restore across multiple source change sets" yet.

## Referenced docs

* [`docs/rollback_architecture_v1.md`](rollback_architecture_v1.md) — conceptual model
* [`docs/version_history_v1.md`](version_history_v1.md) — immutable version graph
* [`docs/machine_write_v1.md`](machine_write_v1.md) — proposals as change sets
* [`docs/lifecycle_controls_v1.md`](lifecycle_controls_v1.md) — lifecycle transitions are restorable
* [`docs/import_export_v1.md`](import_export_v1.md) — imports as grouped restore units
