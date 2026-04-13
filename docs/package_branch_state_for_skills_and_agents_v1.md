# Package branch state for Skills and Agents — v1

Skills and Agents are *package* objects: a canonical editable source
plus any number of child files plus (conceptually) nested folders.
Before this pass, the branch model handled the canonical source
correctly, and child file edits landed on their own `branch_heads`
rows, but nothing tied those child edits to the parent package's
draft state. The diff was flat, metadata was main-only, and promote
+ discard only covered versioned fields. This document describes
what changed to make package branching coherent.

## What was incomplete

1. Canonical source branched; child file edits branched independently; the two were not joined.
2. Package metadata (`description`, `tags`, `summary`, `agent_type`, `model_hint`, `system_prompt`) stayed on main even on a branch.
3. Branch diff rendered every head as a standalone row — no package grouping.
4. Promote walked `branch_heads` but didn't pick up metadata changes.
5. Branch review couldn't present "here's what this Skill looks like on the branch" as one coherent picture.

## Schema

`supabase/migrations/20260412000007_branch_package_metadata.sql`
adds `branch_package_metadata`: an overlay table that records per-
`(branch_id, package_type, package_id)` metadata overrides.

| Column          | Type          | Purpose                                   |
|-----------------|---------------|-------------------------------------------|
| `id`            | uuid PK       |                                           |
| `branch_id`     | uuid FK       | ON DELETE CASCADE to `draft_branches`     |
| `package_type`  | text          | CHECK IN `('skill', 'agent')`             |
| `package_id`    | uuid          |                                           |
| `description`   | text          | overlay                                   |
| `tags`          | text[]        | overlay                                   |
| `summary`       | text          | overlay                                   |
| `agent_type`    | text          | agent-only; null for skills               |
| `model_hint`    | text          | agent-only                                |
| `system_prompt` | text          | agent-only                                |
| `created_at`    | timestamptz   |                                           |
| `updated_at`    | timestamptz   |                                           |
| UNIQUE          | `(branch_id, package_type, package_id)`   |

RLS: any workspace member can SELECT overlays on branches in their
workspace; writes go through `can_write_workspace()` via the branch's
`workspace_id`.

## How package branch state works now

### Membership derivation

A Skill's / Agent's package draft is derived, not persisted
separately. `computePackageBranchMembership(supabase, branchId,
packageType, packageId)` in
`src/server/services/package_branch_service.ts` lists every
`branch_heads` row of type `file` on the branch, then joins against
`files.parent_skill_id` / `files.parent_agent_id` to return only the
child files that belong to the target package.

No new membership table. Parent pointers are already canonical — a
child file cannot become part of a different package without a main
move, and main moves run through their own change_set.

### Package draft state

`getPackageDraftState(supabase, branchId, packageType, packageId)`
returns `{ canonicalSourceVersionId, childHeads, metadataOverlay,
hasAnyChanges }`:

- `canonicalSourceVersionId` = the `branch_heads` row for the
  skill / agent itself, or null if the branch hasn't edited the
  canonical source.
- `childHeads` = array of `{ branchHeadId, fileId, versionId,
  fileName, filePathCache }`, from the membership derivation.
- `metadataOverlay` = the `branch_package_metadata` row, or null.
- `hasAnyChanges` is the convenience union of the three.

Returns null when every element is empty — used by the detail page's
"pending package changes" badge.

### Branch-aware reads

`getSkillForWorkspace(.., branchId)` and `getAgentForWorkspace(..,
branchId)` already overlayed the canonical source. They now also
overlay metadata via `applyPackageMetadataOverlay`, so a Skill or
Agent loaded with a branch id returns the fully coherent draft row
— canonical source + all branch-aware metadata overlaid. Non-
versioned fields outside the overlay (name, status, is_reusable,
canonical_format) continue to come from main.

### Save path

`saveSkillAction` and `saveAgentAction` route automatically on
`ctx.activeBranchId`:

- Canonical source → `updateSkillContentOnBranch` /
  `updateAgentContentOnBranch` (unchanged; writes
  `object_versions` + `branch_heads`).
- Metadata → `upsertPackageMetadataOverlay` with only the fields the
  package type allows. Calling an agent-only field on a skill
  request silently drops it — matches the main services' tolerance.

### Package-aware diff

`branch_diff_service.ts` now returns `{ rows, packages, standalone,
… }`. `packages` is an array of `PackageDiffGroup`:

```ts
{
  packageType: "skill" | "agent",
  packageId: string,
  packageName: string,
  packageHref: string,
  canonical: BranchDiffRow | null,       // canonical source row
  children: BranchDiffRow[],              // child file heads
  metadataChanges: PackageMetadataChange[],
}
```

`metadataChanges` is derived by comparing the overlay against
main; unchanged fields are omitted.

`standalone` captures every branch_heads row that is NOT part of a
package — notes, box-level files, attachments, etc.

The `/app/branches/[id]` detail page renders packages first (with
their canonical source + child files + metadata changes grouped
visually), then standalone rows below. Each metadata change shows
main value vs. branch value side-by-side.

### Promote

`promoteBranch` now, after walking branch_heads, reads every
`branch_package_metadata` row for the branch and applies the overlay
to the canonical `skills` / `agents` row. The write is added to the
same `origin: 'branch_promotion'` change set as a `change_set_item`
with `operation: 'update'`, `before_snapshot: { metadata }`, and
`after_snapshot: { metadata, from_branch }`. Restoring the
promotion change set reverts metadata to main's prior values —
same mechanism as canonical source restore.

### Discard

Unchanged shape. The branch is marked `discarded`; overlay rows and
branch_heads remain as permanent audit trail. Reads filter on
branch status so discarded drafts stop appearing to editors.

## What is branch-aware now

### Skills

| Field             | Branch-aware? | Notes                                                |
|-------------------|:-------------:|------------------------------------------------------|
| `source_content`  | ✅            | object_versions + branch_heads                       |
| `description`     | ✅            | `branch_package_metadata.description`                |
| `tags`            | ✅            | `branch_package_metadata.tags`                       |
| `summary`         | ✅            | `branch_package_metadata.summary`                    |
| Child files       | ✅            | branch_heads + membership derivation                 |
| `name` / status / `is_reusable` / `canonical_format` | ❌ | explicit main-only |
| Child folder structure | ❌       | see "Out of scope" below                             |
| Add/remove child files | ❌       | new file creation still lands on main                |

### Agents

| Field             | Branch-aware? | Notes                                                |
|-------------------|:-------------:|------------------------------------------------------|
| `source_content`  | ✅            | object_versions + branch_heads                       |
| `description`     | ✅            | `branch_package_metadata.description`                |
| `tags`            | ✅            | `branch_package_metadata.tags`                       |
| `summary`         | ✅            | `branch_package_metadata.summary`                    |
| `agent_type`      | ✅            | `branch_package_metadata.agent_type`                 |
| `model_hint`      | ✅            | `branch_package_metadata.model_hint`                 |
| `system_prompt`   | ✅            | `branch_package_metadata.system_prompt`              |
| Child files       | ✅            | branch_heads + membership derivation                 |
| `name` / status / `is_reusable` / `canonical_format` | ❌ | explicit main-only |
| Child folder structure | ❌       | see "Out of scope"                                   |
| Agent → Skill references | ❌     | stays main-only in V1 (per prompt guidance)          |
| Add/remove child files | ❌       | new file creation still lands on main                |

## UI

- `ActiveBranchBanner` (rendered by `ActiveBranchBannerServer`) now
  accepts an optional `packageNote`. On skill / agent detail pages
  that note reads e.g. *"This package has branch changes: canonical
  source · 3 child files · metadata."*
- The branch detail page renders the Skill & Agent package groups
  ahead of the standalone section. Each group is collapsible and
  contains the canonical-source diff card, child-file diff cards,
  and a metadata-change table with main-vs-branch columns per field.
- Package group header has its own "Open package" link that routes
  through the active-branch cookie, so the editor opens the draft
  view automatically.

## Tests

`src/tests/unit/package_branch_service.test.ts` (11 cases)

- `branchableMetadataFieldsFor` surfaces skill vs agent field lists
- `computePackageBranchMembership` filters child files by
  `parent_skill_id` / `parent_agent_id`
- agent-only fields passed for a skill are silently dropped by
  `upsertPackageMetadataOverlay`
- `getPackageMetadataOverlay` returns null vs row correctly
- `applyPackageMetadataOverlay` patches declared fields, leaves
  others alone
- `getPackageDraftState` returns null when the branch has no
  package state at all and a non-null state when any element is
  present

Plus pre-existing 6-case diff service coverage updated with the
new `.in()` builder so the grouped-rows path compiles against the
mock.

Full suite: 299 / 299 passing.

## Out of scope (V1)

- **Structural adds / removes on branch.** Creating a brand-new
  child file while a branch is active currently lands on main
  immediately — there is no "pending object" concept yet. Same for
  moving files in or out of a package on a branch. Closing this
  requires a pending-object design separate from the overlay
  pattern.
- **Child folder branching.** Folders aren't versioned; branching
  them needs its own design (snapshot table vs. event log).
- **Agent → Skill reference branching.** Attachments /
  reusable-skill references on an agent stay main-only. Per the
  prompt's "fully or not at all" instruction, they remain main-
  routed until a coherent design lands.
- **Three-way merge.** Context Store's resolution mechanism is still
  promote (overwrite) or discard. The `mainMovedAhead` signal + the
  restore engine's `dirtyAfter` cover the overwrite-awareness need.

## Related docs

- [branch_aware_writes_v1.md](branch_aware_writes_v1.md) — the
  per-object write / read / promote contract.
- [rollback_schema_and_restore_engine_v1.md](rollback_schema_and_restore_engine_v1.md)
  — restores of package promotions flow through the existing
  engine unchanged.
- [skills_object_and_editor_v1.md](skills_object_and_editor_v1.md)
  — skill package surface.
- [agents_object_and_editor_v1.md](agents_object_and_editor_v1.md)
  — agent package surface.
