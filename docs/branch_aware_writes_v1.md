# Branch-aware writes — v1

The draft-branch schema + resolver shipped with the foundation
rollback prompt. This document covers the write path that makes them
useful: editing content on a branch without touching main, and
promoting the branch back when the experiment works.

## Design in one paragraph

A draft branch is a named handle under which content edits can
accumulate without mutating each object's canonical
`current_version_id`. On a branch, every edit writes an immutable
`note_versions` row and moves a `branch_heads` pointer — main is
untouched. Promoting a branch walks every branch head and advances
the underlying object's `current_version_id` to the branch version
inside a single `origin: 'branch_promotion'` change set. Discarding a
branch marks it discarded; the version rows written against it stay
as permanent audit trail.

## Active branch resolution

- New cookie: `active_branch_id`. Set via
  `setActiveBranchAction(branchId)`; cleared by passing `null`.
- `getRequestContext()` reads the cookie, validates the branch is in
  the active workspace and still `open`, and surfaces it as
  `RequestContext.activeBranchId`. A stale cookie (promoted /
  discarded / deleted branch) is silently cleared at resolution time.
- Every service that wants branch semantics reads this field; every
  service that doesn't (imports, lifecycle, the restore engine
  itself) explicitly ignores it.

## Write path

`src/server/services/note_service.ts` exposes two update functions:

* `updateNote(...)` — the existing main write. Unchanged. Advances
  `notes.current_version_id` via the `update_note_and_create_version`
  RPC.
* `updateNoteOnBranch(supabase, userId, workspaceId, branchId,
  noteId, { title, markdownContent, … })` — the new branch write.
  Writes a new immutable `note_versions` row with `parent_version_id`
  set to either the current branch head (if this branch has edited
  the note before) or `notes.current_version_id` (first edit on the
  branch). Then upserts `branch_heads` to point at the new version.
  The `notes` row is never touched.

The note save action routes automatically:

```ts
// src/app/app/notes/actions.ts — saveNoteAction
if (activeBranchId) {
  await updateNoteOnBranch(supabase, userId, workspaceId, activeBranchId, noteId, …);
} else {
  await updateNote(supabase, userId, workspaceId, noteId, …);
}
```

Callers that want pristine main writes regardless of the user's
active branch can construct the context manually and omit
`activeBranchId` (the restore engine does this for its own audit
trail).

Branch writes fire a distinct audit event: `note.branch_updated`.
This keeps main edits and branch edits easily filterable in the
Audit Log without widening `change_origin`.

## Read path

`getNoteForWorkspace(supabase, noteId, workspaceId, branchId?)` now
accepts an optional fourth argument. When set, it:

1. Resolves the branch's head for this note via
   `resolveBranchVersion`.
2. If a head exists, patches the returned Note's `title`,
   `markdown_content`, `content_bytes`, and `current_version_id`
   with the branch version's values.
3. If no head exists, returns the canonical main record unchanged.

Only the versioned content fields override. Status, folder placement,
tags, summary, and other non-versioned metadata come from the
canonical `notes` row. This is deliberate for V1 — branches are a
content-editing primitive, not a structural one.

## Promote

`promoteBranch(supabase, workspaceId, actorId, branchId)` (service)
→ `promoteBranchAction(branchId)` (server action, role-gated).

Steps:

1. Validate branch exists, belongs to the workspace, and is `open`.
2. Open an `origin: 'branch_promotion'` change set with
   `metadata.branch_id` + `metadata.head_count`.
3. For every `branch_heads` row of type `note`:
   - Read the branch version's content and the note's prior
     `current_version_id`.
   - Update `notes.current_version_id` to the branch version (and
     mirror the content fields onto the canonical row).
   - Tag the version with `change_set_id` so planners can trace the
     advance.
   - Record a `change_set_item` (`operation: 'update'`) with before
     / after version ids.
4. Commit the change set; mark the branch `promoted`.

Restoring the promotion change set reverts the pointer moves — it
doesn't delete the branch heads. A future "re-promote" is a separate
action against the original branch, not a restore.

Failure semantics: throw on first head failure; abort the change set;
branch stays `open`. Partial promotes would require a filter-style
argument; none ship in V1.

## Discard

`discardBranchAction(branchId)` marks the branch `discarded` and
removes the `active_branch_id` cookie if the discarded branch was
active. Branch heads are left intact — they're a durable record of
what got drafted.

## UI

- `/app/branches` — list view. Renders every branch in the active
  workspace with its head count, active indicator, and write actions:
  Switch / Switch to main / Promote / Discard.
- "Editing against" header at the top of the page makes the current
  write target unambiguous.
- A sidebar nav link `Branches` (`GitBranch` icon) opens the list.
- Create is a dialog with name + description.
- Promote + discard each open a confirm dialog with a clear
  explanation of the consequences.

Role gating: any workspace member sees the page; write actions
require `canWrite` (member / admin / owner). The role gate fires on
every server action call; the UI hides controls viewers can't use.

## Scope vs deferrals

**V1.1 covers branch-aware writes for every content-bearing object:**

- Active-branch resolution via cookie + request context
- **Notes** — `updateNoteOnBranch` + `getNoteForWorkspace(..,
  branchId)` + promote + discard.
- **Files** — `updateFileContentOnBranch` (in `file_service.ts`) +
  `getFileForWorkspace(.., branchId)`.
- **Skills** — `updateSkillContentOnBranch` + `getSkillForWorkspace(..,
  branchId)`. Only the canonical editable source is branch-aware;
  child files remain on main.
- **Agents** — `updateAgentContentOnBranch` +
  `getAgentForWorkspace(.., branchId)`. Same canonical-source-only
  scope as Skills.
- `promoteBranch` now walks every branch head, dispatching on
  object_type: notes use `note_versions` + the notes row; files /
  skills / agents share `object_versions` + their canonical table.
  Every promoted version is tagged with `change_set_id` so the
  rollback engine can walk `branch_promotion → versions`.
- Shared UI: `ActiveBranchBannerServer` renders a compact "Editing
  on draft branch X" banner at the top of every content-bearing
  detail page (notes, files, skills, agents) when a branch is
  active.
- Save actions for each object type auto-route: if
  `ctx.activeBranchId` is set → branch path; otherwise main path.

**Deliberately deferred (no user-impact gap):**

- **Non-versioned field overrides on branch.** Title / summary /
  tags / description / `read_hint` / `agent_type` / `model_hint`
  all stay on main until promote. Adding per-branch metadata would
  need a companion `branch_head_metadata` table. The shared
  editor-layer contract today is "branches own the canonical source
  only"; notes are an apparent exception because `title` lives on
  `note_versions`, but the structural semantic is identical.
- **Child-file branching inside skills/agents.** A skill's or
  agent's nested files are individual File objects and can be
  branch-edited through their own `/app/files/<id>` page. The
  skill/agent detail page itself edits only the canonical source.
- **Three-way merge.** Still out of scope. Promote is the product's
  resolution mechanism. The restore engine's `dirtyAfter` signal
  flags overwrites on the promotion change set.
- **Per-object branch switch.** You can only have one active branch
  at a time.

## Tests

Note semantics: `src/tests/unit/branch_semantics.test.ts` (5 cases)

- branch write creates a new immutable `note_versions` row with the
  correct parent pointer
- branch write upserts a `branch_heads` row
- **branch write NEVER touches the `notes` row** (core invariant)
- non-open branches rejected
- cross-workspace branches rejected
- branch reads fall back to main when no head exists

File / skill / agent semantics:
`src/tests/unit/object_branch_semantics.test.ts` (18 cases,
parameterised across the three versioned object types)

- same invariants applied against `object_versions` +
  `files`/`skills`/`agents`
- read-through returns branch head when present
- read-through returns null to trigger main fallback when absent
- null branchId short-circuits without a DB call

Full suite: **282 / 282 passing**.

## Related docs

- `docs/rollback_architecture_v1.md` — conceptual rollback model
- `docs/rollback_schema_and_restore_engine_v1.md` — engine surface
- `docs/version_history_v1.md` — immutable version invariant
