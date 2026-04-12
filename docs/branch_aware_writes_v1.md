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

**V1 covers:**

- Active-branch resolution via cookie + request context
- Branch writes on notes (content + title)
- Branch-aware reads on notes
- Promote (notes)
- Discard
- `/app/branches` page with full CRUD

**Deliberately deferred (no user-impact gap in V1):**

- **File / skill / agent branch writes.** The promote service reads
  `branch_heads` rows by object_type; notes are wired, files /
  skills / agents use the same mechanism once their save paths call
  `updateFileOnBranch` / `updateSkillOnBranch` / `updateAgentOnBranch`
  (parallel to `updateNoteOnBranch`). Schema + head resolver already
  support them.
- **Non-versioned field overrides on branch.** Summary, tags, and
  `read_hint` stay on main until promote. Adding branch-side
  overrides would need a companion `branch_head_metadata` table;
  product-wise it's not obviously wanted yet.
- **Three-way merge.** Still out of scope. The product's resolution
  mechanism is promote (winner-takes-all) or discard. A branch
  whose main head moved ahead before promote simply overwrites
  those main changes — the restore engine catches them as
  `dirtyAfter` warnings on the promotion change set.
- **Per-object branch switch.** You can only have one active branch
  at a time. Editing note A on branch X and note B on branch Y
  requires switching between them.

## Tests

`src/tests/unit/branch_semantics.test.ts` covers:

1. Branch write creates a new immutable version with the correct
   parent pointer.
2. Branch write upserts a `branch_heads` row.
3. Branch write NEVER touches the `notes` row (the core invariant).
4. Branch writes against a non-open branch are rejected.
5. Cross-workspace branch writes are rejected.
6. Branch reads fall back to main when no head exists.

Full suite: 264 / 264 passing.

## Related docs

- `docs/rollback_architecture_v1.md` — conceptual rollback model
- `docs/rollback_schema_and_restore_engine_v1.md` — engine surface
- `docs/version_history_v1.md` — immutable version invariant
