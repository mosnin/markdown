# Branch-local sort order and reorder isolation — v1

Drag-and-drop reorder and cross-folder move were the last
main-mutating leak in branch mode. Even with branch-local creation,
folder overlays, and pending ops landed, the tree's
`writeSiblingOrder` and the cross-folder paths in
`moveTreeNodeAction` still wrote directly to
`workspace_objects.sort_order`, the leaf table's `folder_id`, and
`box_object_attachments.folder_id` on every drag — irrespective of
whether a branch was active. Other workspace members and other
branches saw the reorder immediately. This document describes the
schema and service-layer changes that close it.

## The gap

Previously, with an active branch:

- Reordering siblings in the box tree wrote
  `workspace_objects.sort_order` for every entry in the new order.
- Moving a note / file / skill / agent into another folder wrote
  `notes.folder_id` / `files.folder_id` / `skills.folder_id` /
  `agents.folder_id` and `workspace_objects.folder_id` on the
  canonical row.
- Moving an attached reusable skill or agent across folders inside
  a box wrote `box_object_attachments.folder_id` on the canonical
  attachment row.

Every one of these violated the "branches must not silently mutate
main" trust rule. The folder-rename and folder-reparent leaks were
already plugged via `folder_branch_overrides`; this pass extends
the same overlay pattern to the rest of the placement state.

## Schema

Migration `20260413000002_branch_placement_overrides.sql`:

```sql
CREATE TABLE branch_placement_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id            uuid NOT NULL REFERENCES draft_branches(id) ON DELETE CASCADE,
  target_type          text NOT NULL CHECK (target_type IN (
                         'workspace_object', 'box_object_attachment')),
  target_id            uuid NOT NULL,
  object_type          text,
  object_id            uuid,
  box_id               uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  sort_order           bigint,
  folder_id            uuid,
  folder_id_overridden boolean NOT NULL DEFAULT false,
  actor_id             uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, target_type, target_id)
);
```

Indexes: `(branch_id, box_id)` for the branch-scoped per-box reads
the tree issues on every render, and `(target_type, target_id)`
for the `dropPlacementOverridesForTarget` rollback path.

RLS mirrors `folder_branch_overrides`: a single `FOR ALL` policy
that joins through `draft_branches.workspace_id` and uses
`owns_workspace` for SELECT and `can_write_workspace` for the
WITH-CHECK clause.

### Field semantics

- `target_type` selects the table the overlay shadows. Native
  placement (notes / files / folders / skills / agents inside their
  owning box) overlays a `workspace_objects` row. Reusable skills /
  agents attached into a box overlay the corresponding
  `box_object_attachments` row.
- `target_id` is the PK of the shadowed row, so promote and reads
  can address the canonical without re-deriving the lookup.
- `object_type` / `object_id` denormalise the canonical pointer
  for diff display. Set on every overlay (for both shapes), so
  diff rendering doesn't have to join the canonical row twice.
- `sort_order` is `NULL` to mean "no sort override". A move-only
  overlay will leave this column null; a reorder-only overlay will
  populate it but leave the folder columns alone.
- `folder_id` is paired with `folder_id_overridden`. The flag is
  required because `NULL` is a legal explicit override value
  ("moved to root on this branch") and the column alone can't
  distinguish that from "no override".

## Service — `placement_branch_service.ts`

- `upsertPlacementOverride({ branchId, actorId, targetType,
   targetId, objectType?, objectId?, boxId, patch })` — upserts on
  the unique key. The patch is `{ sortOrder?, folderId?,
  folderIdOverridden? }`; only declared keys are written, so
  successive drags on the same target merge into one overlay row.
- `getPlacementOverride / listPlacementOverridesForBranch /
  listPlacementOverridesForBox` — reads used by the repository
  overlay path and the diff service.
- `applyPlacementOverrideToRow` / `applyPlacementOverridesToList`
  — pure functions. `sort_order` overlays only when non-null;
  `folder_id` overlays only when `folder_id_overridden=true`. The
  input rows are never mutated.
- `promotePlacementOverrides(branchId)` — copies every overlay's
  declared fields back onto the canonical row. For native (workspace_object)
  overlays the leaf table's `folder_id` is updated alongside the
  index entry so readers that bypass workspace_objects see the
  same state. Returns `{ targetType, targetId, objectType, objectId,
  before, after }[]` so the change-set recorder can persist
  per-row history.
- `dropPlacementOverride / dropPlacementOverridesForTarget /
  dropAllPlacementOverridesForBranch` — rollback + discard.

## Reader integration

- `loadSiblings` in `src/app/app/boxes/actions.ts` accepts a
  `branchId` parameter. When set it loads the full box (no
  folder_id filter on the SQL side) and applies the overlay to
  every row before filtering by `effectiveFolderId`. That makes
  the comparator see the overlaid `(folder_id, sort_order)` so a
  user dragging again on the same branch sees their prior
  reorder/move stacked correctly.
- `writeSiblingOrder` accepts `{ branchId, actorId }`. With a
  branch set it routes every sibling's new sort_order through
  `upsertPlacementOverride` on `branch_placement_overrides`. With
  no branch it falls back to the prior direct update on
  `workspace_objects` / `box_object_attachments`.
- `listWorkspaceObjectsByBox` and `listAttachmentsForBox` accept
  `branchId`. Same shape — bulk-load overrides per box, apply via
  `applyPlacementOverridesToList`, re-sort.

## Write path

In `moveTreeNodeAction`:

- The folder reparent for native objects (note / file / skill /
  agent) routes through `upsertPlacementOverride({ folderId,
  folderIdOverridden: true })` against the workspace_objects PK
  when a branch is active. `path_cache` recompute is deferred to
  promote because the canonical folder tree is unchanged on the
  branch until then.
- The attachment folder move (reusable skill or agent) does the
  same against the `box_object_attachment` PK.
- The trailing `writeSiblingOrder` call passes `activeBranchId`,
  so the reorder write also stays out of main.

The folder-on-folder reparent path was already overlay-routed via
`folder_branch_overrides`; this pass leaves that branch alone.

## Promote + discard

- `promoteBranch` calls `promotePlacementOverrides(branchId)`
  after the folder-overlay pass and before the pending-ops pass.
  Each promoted overlay becomes a `change_set_item` with
  `operation: "move"` when `folder_id` changed and
  `operation: "update"` when only `sort_order` changed. For
  native objects we map `target_id` (a workspace_objects PK) to
  the inner `object_type` / `object_id` so the change_set CHECK
  on `object_type` is satisfied; attachment overlays use
  `object_type: "box_object_attachment"`.
- `discardBranchAction` calls `dropAllPlacementOverridesForBranch`
  after the pending-op and folder-overlay drops. Overlays only
  ever represented intent, main is untouched, so there's nothing
  to audit.

## Diff surface

`getBranchDiff` returns `placementChanges: PlacementChangeRow[]`
alongside `rows`, `packages`, `pendingOps`, and `folderOverrides`.
Each row carries `{ targetType, targetId, objectType, objectId,
displayName, before, after }` where `before` / `after` are
`{ sortOrder, folderId }` snapshots. Rows where the overlay
matches main exactly are dropped (no-op overlays).

The branch detail client renders a "Placement changes" section
with one card per overlay, reusing the existing
`MetadataChangeRow` component so the visual shape matches the
folder-changes and package-metadata-changes sections.

## Related docs

- [branch_aware_writes_v1.md](branch_aware_writes_v1.md)
- [branch_local_structural_creation_v1.md](branch_local_structural_creation_v1.md)
- [package_branch_state_for_skills_and_agents_v1.md](package_branch_state_for_skills_and_agents_v1.md)
- [rollback_schema_and_restore_engine_v1.md](rollback_schema_and_restore_engine_v1.md)
