# Note dual view and autosave — V1

This document describes the note editor's dual view model, autosave behavior,
save state semantics, and the rules that preserve versioning and trust semantics.

Later prompts must preserve all rules described here.

---

## Two-mode note model

Every note has exactly two views:

| Mode | Label | What it shows |
|---|---|---|
| Document | Document | Rendered markdown — a readable human document |
| Markdown | Markdown | The raw stored markdown string, editable, labeled as the AI-facing source |

### Why two modes, not three

An earlier implementation had three modes: Document, Edit, and Source. This was
collapsed to two because:

- "Edit" and "Source" were both the raw markdown — they differed only in editability
- Having an editable textarea AND a separate read-only source view created confusion
- The canonical principle is: **the stored markdown IS the AI source**. Showing them
  as separate surfaces implied a transformation that doesn't exist.

The Markdown mode is now the single markdown surface: editable, labeled as the
exact AI-facing source, copy-safe, inspectable.

---

## Document view

Document view renders the stored markdown as styled HTML via `renderMarkdown`.
It is the **default view when opening a note**.

**Behavior:**
- Read-only rendered presentation (prose styling)
- Clicking anywhere in the content or focusing the title field switches to Markdown mode
- Empty notes show a "Click to start writing…" placeholder
- Renders using `prose prose-neutral dark:prose-invert` Tailwind typography classes

**What it is not:**
- Not a rich text editor — there is no WYSIWYG, no proprietary document model
- Not a converted representation — the rendered HTML comes directly from the stored markdown
- Not the source of truth — it is a view of the source

---

## Markdown view

Markdown view shows the **exact stored markdown string** in a full-height monospace
textarea. This is what the AI model receives, unmodified.

**Behavior:**
- Editable textarea with monospace font
- Labeled with a subtle banner: "Raw markdown — the exact source the AI model receives"
- Autosave fires 1500ms after the last change (debounced)
- Metadata section (summary, tags, read hint) is available as an expandable `<details>`
  at the bottom — also autosaved on change

**What the label communicates:**
- The user is looking at the exact bytes that will be sent to an AI model
- No transformation, no escaping, no preprocessing
- Copyability and inspectability are first-class concerns

**What Markdown mode is not:**
- Not a debugging tool or developer afterthought — it is a first-class editing surface
- Not a "preview" — the textarea IS the source, not a view of it

---

## Autosave model

### Debounce strategy

Autosave uses a **1500ms idle debounce** implemented with `useEffect` + `useRef`.

```
User types → timer resets → 1500ms of idle → performSave() fires
```

If content changes again before the timer fires, the timer is reset. This means:
- Rapid typing does not create a new version on every keystroke
- A note is saved approximately 1.5 seconds after the user stops typing
- Version history remains meaningful (one version per editing session, not per character)

### Watched fields

The autosave timer resets when any of these fields changes:
- `title`
- `markdown_content` (the textarea body)
- `summary`
- `tags`
- `read_hint`

### Save path

Every autosave call goes through:
```
performSave()
  → saveNoteAction(note.id, { title, markdownContent, summary, tags, readHint })
  → update_note_and_create_version RPC (Postgres, atomic)
  → new immutable note_versions row + updated note fields
```

This is **identical to the manual save path**. No special autosave route. No
weaker guarantees. Versioning, optimistic concurrency, and audit semantics are
fully preserved.

### Autosave does not run on mount

The autosave effect only fires when `isDirty` is true. `isDirty` compares the
current field values against `lastSavedSnapshot` (a ref initialized from the server
props). Opening a note never fires an autosave; only actual edits do.

### Concurrent saves are guarded

`performSave` is guarded by `isSaving`. If a save is already in flight and more
content changes arrive, the debounce timer resets but `performSave` will not start
a second save until the first completes.

After a save completes, `lastSavedSnapshot` is updated with the saved content.
If the user continued typing during the save, `isDirty` becomes true again,
the effect fires, and a new debounce timer starts.

---

## Save state model

The `AutosaveState` type has five values:

| State | Display | Meaning |
|---|---|---|
| `idle` | (nothing shown) | No unsaved changes, no recent activity |
| `unsaved` | `● Unsaved` (dim) | Content changed; debounce timer is running |
| `saving` | `⟳ Saving…` | Save request is in flight |
| `saved` | `✓ Saved just now` / `✓ Saved Xm ago` | Last save succeeded |
| `error` | `⊘ [error message]` | Last save failed; Retry button appears |

### State transitions

```
(user edits)  →  unsaved
(debounce)    →  saving
(success)     →  saved  →  (4s)  →  idle
(failure)     →  error
(retry)       →  saving
```

### "Unsaved" is intentionally subtle

The `unsaved` state uses a small dim dot + "Unsaved" in `text-muted-foreground/70`.
It is not a warning — autosave is about to handle it. The styling communicates
"there's something in progress" without implying the user needs to act.

### "Saved" fades to idle

After a successful save, the indicator shows "Saved just now" (or "Saved Xm ago").
After 4 seconds, it transitions back to `idle` and disappears. This keeps the
toolbar clean when the user is not actively editing.

### Error state requires action

When autosave fails, the indicator turns destructive (`text-destructive`) and a
Retry button appears. The error does not auto-dismiss. The user must either retry
or reload the page.

---

## Versioning and trust preservation

### Every autosave creates a version

`update_note_and_create_version` always creates a new `note_versions` row. There is
no "silent update" path. Every autosave produces an entry in the version history.

Implication: version history will contain autosave checkpoints. These are legitimate
version entries — each one represents a real saved state of the note. Rollback works
on any of them.

### Autosave does not bypass optimistic locking

The `update_note_and_create_version` RPC performs its own consistency checks. If a
conflict occurs (e.g., a machine write was approved between the user's last load and
their save), the RPC returns an error. This error surfaces in the `error` autosave
state with the server's error message.

### Machine write paths are not affected

Autosave only operates in the human note editor client component. Machine write paths
(write proposals, generated notes) go through separate server actions and API routes
that do not interact with the client-side autosave state.

### Rollback still works

Rolling back via `NoteHistoryPanel` calls `rollbackNoteAction`, which creates a new
version from the selected historical snapshot. The autosave timer in the editor client
has no knowledge of this server-side operation. After rollback, `router.refresh()`
reloads the note data, resetting `lastSavedSnapshot` and clearing `isDirty`.

---

## Note page composition

The note page uses the three-pane workspace model:

```
[sidebar] | [center: breadcrumb + NoteEditor] | [right: NoteContextPanel]
```

**Center pane structure:**
1. Top bar: breadcrumb + guide/generated badges + lifecycle menu + export menu
2. Generated note banner (if applicable)
3. NoteEditor filling the remaining space

**NoteEditor structure:**
1. Title field (switching to Markdown mode on focus)
2. Toolbar: [Document] [Markdown] mode toggle | save state | Retry
3. Content area: Document view OR Markdown view (textarea + source label)
4. Metadata section: summary, tags, read hint (Markdown mode only, collapsible)

**Right pane tabs:**
- Info: kind, guide status, tags, location, version ID, last updated, summary, read hint
- Links: SemanticLinksPanel ("Context relationships" framing, not backlinks)
- Bundle: ContextBundleViewer
- History: NoteHistoryPanel (version list + rollback)

---

## Rules for future prompts

1. **Markdown remains the canonical source of truth** — no proprietary document model, no conversion layer.
2. **Two modes only** — do not reintroduce a third "source" or "preview" mode. The Markdown mode IS the source.
3. **Do not remove the Document mode** — it is the default reading experience.
4. **Do not remove the source label in Markdown mode** — the user must understand they are looking at the AI-facing source.
5. **Autosave debounce is 1500ms** — do not reduce below 500ms (version noise) or above 5000ms (feedback lag).
6. **Autosave must use saveNoteAction** — do not create a weaker or separate update path for autosave.
7. **"Unsaved" state must remain visible** — do not hide the unsaved indicator; users must know when changes are pending.
8. **Error state must not auto-dismiss** — save failures require acknowledgement (Retry or reload).
9. **Metadata section in Markdown mode** — summary, tags, and read hint must remain editable and autosaved.
10. **Right pane is persistent at lg+** — do not move Info/Links/Bundle/History into the center pane.
