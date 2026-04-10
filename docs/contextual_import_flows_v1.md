# Contextual Import Flows (v1)

## Summary

Import is now available at three levels of the content hierarchy:

| Level | Entry point | Accepts | Behavior |
|---|---|---|---|
| Box | Header "Import" button | `.md`, `.zip` | Creates notes/folders inside the box |
| Folder | Inline import icon on each folder row (Tree tab) | `.md`, `.zip` | Pre-selects that folder as the import target |
| Note | "Import" button in top bar | `.md` only | Replaces or appends note body; creates new version |

All three levels preserve trust, versioning, collision handling, and audit semantics as documented in [import_export_v1.md](import_export_v1.md).

---

## Box-level import

### What changed

The existing `ImportDialog` / `ImportTriggerButton` in the box header gained a `boxName` prop so the dialog now displays the target context explicitly:

```
Import into Research
Upload a .md file or .zip package
```

Previously the dialog showed only "Import" with no indication of where files would land.

After a successful import `router.refresh()` is called client-side (in addition to `revalidatePath` in the server action) so the box page reflects the new content without a manual refresh.

### Files

| File | Change |
|---|---|
| `src/components/product/import_dialog.tsx` | `boxName` prop added to `ImportDialog` and `ImportTriggerButton`; header updated; `router.refresh()` on success |
| `src/app/app/import_export/actions.ts` | Added `revalidatePath('/app/boxes/${boxId}')` and `revalidatePath('/app')` after successful import |
| `src/app/app/boxes/[box_id]/page.tsx` | Passes `boxName={box.name}` to `ImportTriggerButton` |

---

## Folder-level import

### Entry point

A `FolderImportButton` (upload icon) appears next to each folder row in the box Tree tab. The button is `opacity-0` at rest and becomes visible on row hover (`group-hover:opacity-100`). Clicking it opens `ImportDialog` with that folder pre-selected.

```
Research box > Tree tab > hover "Papers" folder → [upload icon] appears
```

### How it works

1. `BoxContentsTree` now accepts a `folderActions` render prop alongside the existing `folderLifecycleMenu`.
2. The box page passes a `FolderImportButton` as `folderActions`.
3. `FolderImportButton` renders the upload icon and, when clicked, opens `ImportDialog` with `initialFolderId` and `initialFolderPath` set.
4. `ImportDialog` initialises `targetFolderId` state from `initialFolderId` (previously always empty), and shows the target path in the subheading.
5. After import the same `router.refresh()` fires as for box-level import.

No new server action was needed — `importPackageAction` already supported `target_folder_id`.

### Files

| File | Change |
|---|---|
| `src/components/product/import_dialog.tsx` | `initialFolderId`, `initialFolderPath` props on `ImportDialog`; new `FolderImportButton` export |
| `src/components/product/box_contents_tree.tsx` | `folderActions` render prop added; `group` class on folder header div for hover reveal |
| `src/app/app/boxes/[box_id]/page.tsx` | Passes `folderActions` callback with `FolderImportButton` to Tree tab's `BoxContentsTree` |

---

## Note-level import

### What this is

A new flow that imports a `.md` file **into an existing note** — either replacing its body or appending to it. This is distinct from box/folder import (which creates new notes).

Entry point: "Import" button in the note page top bar, next to the lifecycle menu and export menu.

### Import modes

Two modes are presented explicitly with radio buttons:

**Append** (default)  
Adds the imported content after the current note body, separated by a horizontal rule (`---`). If the note body is empty, no separator is added.

```
[existing note body]

---

[imported content]
```

**Replace**  
Overwrites the entire note body with the imported content. The current body is atomically saved as a prior version before being replaced — no data is lost.

### Title stripping

The leading `# Title` line is stripped from the imported markdown before processing. This handles the common case where the user exports a note (which includes the title as an H1) and re-imports it — without stripping, the title would appear as a heading inside the body.

```ts
const stripped = raw.replace(/^\s*#[^\n]*\n+/, "").trimStart();
```

### Version history

Every note import creates a new version via `update_note_and_create_version` RPC with `p_change_origin = "import"`. This means:

- The import is distinguishable from a human edit in the version history tab.
- The prior body is preserved — both modes are non-destructive in terms of history.
- Metadata (title, summary, tags, read_hint) is preserved unchanged.

### Live update

After a successful import, `importIntoNoteAction` calls `revalidatePath('/app/notes/${noteId}')` server-side. The dialog also calls `router.refresh()` client-side. When the note page re-renders, `NoteEditor` detects the changed `note.current_version_id` prop (added to the reset effect's dependency array) and resets editor state to the new content.

### Ownership verification

`importIntoNoteAction` calls `getNoteForWorkspace(supabase, noteId, workspaceId)` before any write. This performs a two-hop check: `note → box → workspace_id`. If the note doesn't exist or belongs to a different workspace, the action returns `{ ok: false, error: "Note not found" }` without revealing which case applies.

### Files

| File | Change |
|---|---|
| `src/components/product/note_import_dialog.tsx` | New: `NoteImportDialog` and `NoteImportButton` client components |
| `src/app/app/notes/actions.ts` | New: `NoteImportMode` type and `importIntoNoteAction` server action |
| `src/server/services/note_service.ts` | `updateNote` now accepts optional `changeOrigin` param (default `"human_edit"`); passed as `p_change_origin` to RPC |
| `src/components/product/note_editor.tsx` | Reset effect deps changed from `[note.id]` to `[note.id, note.current_version_id]` |
| `src/app/app/notes/[note_id]/page.tsx` | Imports and renders `NoteImportButton` in the top bar |

---

## What was preserved

| Constraint | Status |
|---|---|
| Collision rules | Unchanged — all four modes still apply for box/folder import |
| Note versioning | Unchanged — all paths go through `update_note_and_create_version` RPC |
| Audit events | Unchanged — `import.completed` fires for box/folder; note import creates a version with `change_origin = "import"` visible in history |
| RLS / ownership | Unchanged — all paths verify workspace ownership before any write |
| `ImportSummaryReport` | Unchanged — box/folder import still returns full summary panel |
| Realtime sidebar | Unchanged — Supabase Realtime subscription in `TreeSidebar` fires after import and refreshes the tree automatically |
| Existing `importPackageAction` API | Unchanged — `target_folder_id` was already supported; only `revalidatePath` added |

---

## Deferred

- **Optimistic folder import**: show the incoming notes immediately in the tree before the fetch round-trip completes.
- **Zip support in note import**: currently note-level import accepts `.md` only. Multi-note zips at the note level are undefined — use box-level import for those.
- **Import into note from box Tree**: note row hover could expose a direct "import into this note" affordance in the tree, mirroring the folder import button.
