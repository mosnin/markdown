# Real structural drag-and-drop fix — v1

## Scope

Prior revisions of the tree sidebar wired drag/drop to a server action, but
dropped moves did not actually persist. Folders looked like drop targets
but order never changed across refreshes, files refused to settle inside
folders, and folder-on-folder moves appeared to work but were reverted on
reload. This document describes the real structural fix: one ordering
source of truth, registry entries for every content object, and a move
action that accepts the drop index react-arborist provides.

## Root causes

Three independent faults combined to make drops look like they worked and
then silently revert.

### 1. `sort_order` column was `int4`; writes used `Date.now()`

`workspace_objects.sort_order` and `box_object_attachments.sort_order`
were declared `integer`. The move action wrote `sort_order = Date.now()`
(~1.7 × 10¹², roughly 800× the `int4` maximum). Postgres rejected every
such write. The error was swallowed by the Supabase client path and the
action returned ok. The row's `sort_order` stayed at whatever it was —
typically the default `0`.

### 2. Workspace registry was missing rows for most objects

`20260411000003_workspace_objects_backfill.sql` only backfilled folders
and notes. Files, skills, and agents created before the object-model
transition had no `workspace_objects` row. After the transition new
files/skills/agents registered themselves but with `sort_order = 0`
(never set explicitly). The tree therefore had many rows all sharing
`sort_order = 0`, which then fell through to the secondary sort.

### 3. Client sort used `name.localeCompare` as the secondary key

When two sibling nodes tied on `sort_order` (the common case, given the
two problems above), `buildArboristTree` sorted alphabetically. That
silently clobbered any structural order the user dragged into. Drops
that wrote a new timestamp-like number to `sort_order` had no effect on
the rendered order, because the client never consulted those numbers
once the ties hit.

### 4. `handleMove` discarded react-arborist's drop index

The old `handleMove` forwarded parent/folder information to the server
but ignored `args.index` — the 0-based position within the destination
parent where the drop landed. Even if the other three problems were
fixed, position within a sibling list had nowhere to go.

## The fix

### Schema: migration `20260412000002_tree_ordering_fix.sql`

1. `ALTER COLUMN sort_order TYPE bigint` on both `workspace_objects`
   and `box_object_attachments` so `Date.now()` fits.
2. Insert missing `workspace_objects` rows for every active
   `files`, `skills`, and `agents` row that doesn't already have one.
3. Give every row a distinct, gapped ordinal. Ordering derives from
   `created_at` with `id` as tiebreaker. Ordinals use `ROW_NUMBER() *
   1000` so the service layer can later insert between neighbours
   without a full re-spread.

The migration is idempotent and safe to re-run. It only updates
`sort_order` rows still at the default `0`, so it never clobbers
application-written ordinals.

### Services: register every object with a concrete `sort_order`

`note_service.createNote`, `folder_service.createFolder`,
`file_service.createFile`, `skill_service.createSkill`, and
`agent_service.createAgent` now all insert a `workspace_objects` row
with `sort_order: Date.now()`. `createNote` and `createFolder`
previously didn't insert at all — those two were the biggest gap.

The `sort_order` is only monotonically increasing per process. That's
fine because any meaningful user-driven reorder goes through the move
action, which re-spreads siblings onto gapped ordinals.

### One ordering contract, shared by client and server

`src/server/domain/tree_ordering.ts` exports:

- `compareSiblings` — folders first, then `sort_order` ascending, ties
  broken by `objectId`. Used by both the server `loadSiblings` and the
  client `buildArboristTree`.
- `clampDropIndex` — keeps a folder from landing past the last folder
  and a leaf from landing before the first leaf. react-arborist's drop
  index is relative to the visible folded-in list, so the same clamp
  on both sides prevents "dropped here, landed there" drift.
- `assignGappedOrder` — pure helper that produces `[1000, 2000, ...]`.
- `isFolderCycle` — path-cache based cycle check used by the folder
  guardrail.

The module is dependency-free so both `"use client"` components and
server code import it without pulling server-only modules.

### Move action: real reorder persistence

`moveTreeNodeAction` (src/app/app/boxes/actions.ts) was rewritten to:

1. Resolve the destination folder (honour `targetFolderId` first, fall
   back to the legacy `position`/`targetId` contract for callers that
   haven't migrated yet).
2. Enforce the folder guardrail via `isFolderCycle` using path_cache.
3. Update the dragged node's placement (folder_id + path_cache
   cascade for folder moves, folder_id for attachments, both for
   native leaves).
4. **Re-spread sibling sort_orders at the destination parent.** This
   is the new behaviour. `loadSiblings` pulls every
   `workspace_objects` and `box_object_attachments` row at the
   destination `(box_id, folder_id)`, `clampDropIndex` corrects the
   target index against the folder-first invariant, the dragged entry
   is spliced into the ordered list, and `writeSiblingOrder` writes
   `(i + 1) * 1000` back to the right table for each sibling.

Re-spreading on every drop is slightly heavier than the old "nudge ±1"
approach but eliminates collision risk entirely. Typical sibling counts
are small (<100) so the cost is a non-issue.

### Client handler: forwards the drop index

`handleMove` in `tree_sidebar.tsx` now passes
`targetIndex: args.index` through to `moveTreeNodeAction`. Nothing else
changed in the handler.

## Acceptance checks

Unit tests (`src/tests/unit/tree_ordering.test.ts`) cover:

- Folders sort before leaves regardless of `sort_order`.
- Within a bucket, ordering by `sort_order` ascending.
- `sort_order` ties break by `objectId` deterministically (the
  invariant that lets server and client agree on pre-backfill data).
- `clampDropIndex` pushes leaves out of the folder region and folders
  out of the leaf region.
- `clampDropIndex` handles all-leaves, all-folders, and empty parents.
- `assignGappedOrder` produces `[1000, 2000, ...]`.
- `isFolderCycle` rejects self and descendant moves; allows siblings;
  does not mistake `docs/a` for an ancestor of `docs/ab`.

End-to-end behaviour to verify manually (acceptance criteria for a
reviewer):

- Drag a note between two siblings: order persists across refresh.
- Drag a note into a folder: the note lands inside the folder and the
  folder contents show the note after expansion.
- Drag a folder into another folder: folder + descendants'
  `path_cache` update correctly.
- Drag a folder into itself or a descendant: action returns an error,
  no rows change.
- Drag a reusable skill attachment between folders: the
  `box_object_attachments.folder_id` and `sort_order` update.
- Drag a leaf to index 0 of a parent that has folders at the top: the
  leaf lands directly after the last folder, not before the first.

## Migration notes

Migration `20260412000002_tree_ordering_fix.sql` must run before any
new moves are performed. Existing deployments will silently continue
to behave as before until the migration widens the `sort_order`
columns. Application code was updated in the same commit, so a deploy
that ships the code without the migration will attempt `bigint` writes
against an `int4` column and fail loudly rather than silently — which
is the correct failure mode.
