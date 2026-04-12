# Lifecycle controls V1

Archive, trash, restore, and unarchive for notes, folder subtrees, and boxes.

---

## States

| Status | Visible to retrieval? | Reversible? | Who can do it |
|---|---|---|---|
| `active` | Yes | — | Human |
| `archived` | No | Yes (unarchive) | Human |
| `trashed` | Never | Yes (restore) | Human |

State transitions:

```
active ←→ archived
active → trashed → active (restore)
archived → trashed (via archive+trash, but you'd unarchive first)
```

Trashed content is **excluded from all retrieval and context building**. It does not appear in `listNotesByBox`, `listFoldersByBox`, FTS, context bundles, or the canonical API.

**Box trash is deferred to V1+.** Use archive as the reversible "hide this box" mechanism. A box trash would require cascade + guide note protection + discovery UI.

---

## Guide note protection

A note assigned as a box's guide note (`boxes.guide_note_id`) **cannot be trashed or archived** without first clearing the guide note assignment. This is enforced in the service layer with explicit, human-readable error messages.

For folder subtree operations, if the subtree contains the current guide note, the entire subtree operation is rejected. The guide note assignment is never silently cleared.

---

## Scope of operations

| Operation | Scope | SQL mechanism |
|---|---|---|
| Note archive | Single note | `updateNote({ status: 'archived' })` |
| Note unarchive | Single note | `updateNote({ status: 'active' })` |
| Note trash | Single note | `updateNote({ status: 'trashed' })` |
| Note restore | Single note | `updateNote({ status: 'active' })` |
| Folder archive | Subtree (root + all descendants) | `archive_folder_subtree` RPC |
| Folder unarchive | Subtree (archived rows only) | `unarchive_folder_subtree` RPC |
| Folder trash | Subtree (root + all descendants) | `trash_folder_subtree` RPC |
| Folder restore | Subtree (trashed rows only) | `restore_folder_subtree` RPC |
| Box archive | Box + all non-trashed folders + notes | `archive_box_contents` RPC |
| Box unarchive | Box + all archived folders + notes | `unarchive_box_contents` RPC |

---

## Atomic SQL RPCs

Defined in `supabase/migrations/20260409000007_lifecycle_rpc.sql`.

### `archive_folder_subtree(p_folder_id, p_box_id)`

Uses `WITH RECURSIVE` to walk the folder tree, then bulk-updates all non-trashed folders and their notes to `status = 'archived'`. Touches only rows where `status <> 'trashed'`. Returns `{ folder_count, note_count }`.

### `restore_folder_subtree(p_folder_id, p_box_id)`

Restores only `status = 'trashed'` rows in the subtree to `status = 'active'`. Does not touch archived rows.

### `archive_box_contents(p_box_id)`

Updates the box row itself + all non-trashed folders + all non-trashed notes to `status = 'archived'`.

### `unarchive_box_contents(p_box_id)`

Unarchives the box row itself + all `status = 'archived'` folders + all `status = 'archived'` notes.

---

## Service layer

`src/server/services/lifecycle_service.ts` is the authoritative orchestrator.

```
archiveNote(supabase, userId, workspaceId, noteId)
unarchiveNote(supabase, userId, workspaceId, noteId)
trashNote(supabase, userId, workspaceId, noteId)
restoreNote(supabase, userId, workspaceId, noteId)

archiveFolder(supabase, userId, workspaceId, folderId)
unarchiveFolder(supabase, userId, workspaceId, folderId)
trashFolder(supabase, userId, workspaceId, folderId)
restoreFolder(supabase, userId, workspaceId, folderId)

archiveBox(supabase, userId, workspaceId, boxId)
unarchiveBox(supabase, userId, workspaceId, boxId)
```

Each function:
1. Verifies two-hop ownership: `resource → box → workspace_id`
2. Checks guide note protection (where applicable)
3. Calls the repository function or SQL RPC
4. Fires an audit event (fire-and-forget)
5. Returns the updated entity or subtree counts

---

## Server actions

Human-only. No lifecycle mutations are exposed via the canonical API or MCP.

```
src/app/app/notes/[note_id]/actions.ts
  archiveNoteAction(noteId)
  unarchiveNoteAction(noteId)
  trashNoteAction(noteId)
  restoreNoteAction(noteId)

src/app/app/boxes/[box_id]/actions.ts
  archiveFolderAction(folderId)
  unarchiveFolderAction(folderId)
  trashFolderAction(folderId)
  restoreFolderAction(folderId)
  archiveBoxAction(boxId)
  unarchiveBoxAction(boxId)
```

All return `{ success: boolean; error?: string }` — errors are surfaced inline in the UI.

---

## UI components

```
src/components/product/
├── note_lifecycle_menu.tsx      MoreHorizontal dropdown on the note breadcrumb bar
├── folder_lifecycle_menu.tsx    MoreHorizontal dropdown inline in the folder tree
└── box_lifecycle_menu.tsx       MoreHorizontal dropdown in the box page header actions
```

All components:
- Are `"use client"` with `useTransition` for pending state
- Call the matching server action
- Surface guide note protection errors inline (no crash)
- Confirm before trash (note + folder) and before archive (box, since it cascades)
- Call `router.refresh()` on success

---

## Discovery surfaces

Archived and trashed content appears in dedicated tabs on the box page:

- **Archived tab** — lists archived folders (with path) + archived notes; `FolderLifecycleMenu` attached for unarchive
- **Trash tab** — lists trashed folders + trashed notes; `FolderLifecycleMenu` attached for restore

Tabs are hidden when empty (`archivedCount === 0` / `trashedCount === 0`).

Trashed notes remain navigable by direct URL (the note page renders regardless of status). The `NoteLifecycleMenu` on the note breadcrumb bar shows "Restore from trash" when `noteStatus === 'trashed'`.

---

## Audit events

Every lifecycle mutation fires an audit event via `audit_service.ts`. These are append-only and fire-and-forget (errors swallowed, never break the lifecycle operation).

| Event type | When |
|---|---|
| `note.archived` | `archiveNote` |
| `note.unarchived` | `unarchiveNote` |
| `note.trashed` | `trashNote` |
| `note.restored` | `restoreNote` |
| `folder.subtree_archived` | `archiveFolder` |
| `folder.subtree_unarchived` | `unarchiveFolder` |
| `folder.subtree_trashed` | `trashFolder` |
| `folder.subtree_restored` | `restoreFolder` |
| `box.archived` | `archiveBox` |
| `box.unarchived` | `unarchiveBox` |

---

## Audit log UI

`/app/audit` is a read-only audit event browser. It shows all workspace events across all object types.

```
src/app/app/audit/
├── page.tsx          Server component — loads first 50 events, renders AuditPanel
└── actions.ts        fetchAuditEventsAction — paginated, workspace-scoped

src/components/product/
└── audit_panel.tsx   Client component — filter by actor/object, expand metadata, load more
```

Filter options:
- **Actor**: All / Human / Agent
- **Object type**: All / note / folder / box / write_proposal / connection / note_link

---

## Lifecycle — Files, Skills, Agents

Files, Skills, and Agents support the same `draft → active → archived → trashed` lifecycle as notes.

**New service functions in `lifecycle_service.ts`:**

```
archiveFile / unarchiveFile / trashFile / restoreFile
archiveSkill / unarchiveSkill / trashSkill / restoreSkill
archiveAgent / unarchiveAgent / trashAgent / restoreAgent
```

Each function:
1. Resolves object ownership (box-local: two-hop check; reusable: workspace_id direct check)
2. Updates the `status` column on the object row
3. Fires an audit event (fire-and-forget)

**Reusable objects and attachments:** When a reusable shared Skill or Agent is archived or trashed, `box_object_attachments` rows are **left intact**. The UI shows `ReusableObjectDegradedBadge` on affected attachment references. This is intentional — silent detach would surprise users. To fully remove the object, the owner must explicitly detach it from each box.

**Server actions:**

```
src/app/app/files/lifecycle_actions.ts    — archive/unarchive/trash/restore + rollback
src/app/app/skills/lifecycle_actions.ts   — archive/unarchive/trash/restore + rollback
src/app/app/agents/lifecycle_actions.ts   — archive/unarchive/trash/restore + rollback
```

**UI:** `ObjectLifecyclePanel` (client component) — archive/unarchive/trash/restore with confirmation step for destructive actions. Client wrapper components `SkillLifecycleControls` and `AgentLifecycleControls` wire the panel to object-specific server actions.

**Audit events added:**

| Event | When |
|---|---|
| `file.archived`, `skill.archived`, `agent.archived` | Lifecycle archive |
| `file.unarchived`, `skill.unarchived`, `agent.unarchived` | Lifecycle unarchive |
| `file.trashed`, `skill.trashed`, `agent.trashed` | Lifecycle trash |
| `file.restored`, `skill.restored`, `agent.restored` | Lifecycle restore |

---

## No external API surface

Lifecycle mutations are **human-only**. External connections (canonical API, MCP) cannot archive, trash, restore, or unarchive any content. This is intentional: lifecycle state is owner policy.

The `GET /api/v1/notes/[id]/versions` canonical API endpoint already excludes trashed notes implicitly because note retrieval fails ownership checks when the note's box is not in the connection's allowed set. No changes to the API layer were required.

---

## Design decisions

**Why atomic SQL for subtrees?**
Folder subtree operations touch an unbounded number of rows. A single RPC call inside Postgres is transactional, avoids N+1 round-trips, and can't leave the tree in a partially-updated state if the connection drops mid-operation.

**Why fire-and-forget audit?**
Lifecycle operations are user-facing and must not fail due to an audit subsystem error. The audit log is observability infrastructure, not a control plane.

**Why is box trash deferred?**
A trashed box disappears from the sidebar with no discovery surface unless explicitly searched. This requires a "deleted boxes" recovery UI. Archive is sufficient for "hide this box" in V1 since it is fully reversible.

**Why no `status` column on `note_versions`?**
Version history is a snapshot chain — it records what the note looked like at each point in time. Lifecycle state is current-row metadata on the `notes` table. These concerns are separate.

## Extension: lifecycle transitions are restorable (v1.1)

Lifecycle transitions (archive / unarchive / trash / restore) can now
be enclosed in a change set with `operation: 'archive' | 'unarchive' |
'trash' | 'restore_lifecycle'` items. The restore planner's inverse
map turns each of these into its counterpart on restore, writing the
prior `status` back to the canonical row. Audit remains append-only
and is untouched by the restore; the undoing operation writes a new
audit event on its own change set.

See [`docs/rollback_architecture_v1.md`](rollback_architecture_v1.md)
for the change set / item model and the full invariant list. Lifecycle
services continue to own their own validation logic (guide-note
protection, subtree cascade guards, etc.); the restore service
delegates to them when it needs richer checks.

## Extension: lifecycle change-set wrapper (v1.2)

`src/server/services/lifecycle_change_set.ts` provides
`withLifecycleChangeSet(supabase, args, perform)` — a generic
wrapper that every lifecycle action adopts. It opens an
`origin: 'lifecycle'` change set, runs the actual state transition,
records a `change_set_item` with before/after `status`, and commits
(or aborts on throw). Notes are wired as the reference
implementation; folders / files / skills / agents / boxes adopt the
same wrapper without further code changes.

Restoring a lifecycle change set flips `status` back via the
planner's `inverseOperation` map (`archive ↔ unarchive`, `trash ↔
restore_lifecycle`). See
[`docs/rollback_schema_and_restore_engine_v1.md`](rollback_schema_and_restore_engine_v1.md).
