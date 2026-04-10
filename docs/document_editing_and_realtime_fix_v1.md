# Document Editing and Real-Time Sync Fix (v1)

## Summary

Two core UX problems fixed in one pass:

1. **Document mode was read-only**: clicking the document area forced users into Markdown
   mode. Writers could not type plain English without first switching views.

2. **Sidebar tree was stale**: creating a note or folder required a manual page refresh
   before the item appeared in the sidebar. Real-time changes from other tabs or
   collaborators were never reflected.

---

## Problem 1: Document mode editing

### What was wrong

`NoteEditor` had two modes but only one editable state:

```
Document mode → rendered HTML div (dangerouslySetInnerHTML, read-only)
                onClick / onFocus → forces switch to Markdown mode
                Title onChange / onFocus → also forces switch to Markdown mode

Markdown mode → editable textarea (monospace, labeled "AI-facing source")
```

A user opening a note in Document mode (the default) could not type a single
character without the app switching them to Markdown mode first. The Document
tab was purely a reading surface, not a writing surface.

### Fix

Document mode is now an editable `<textarea>` with proportional font:

```tsx
// Before — read-only div that switches mode on click:
<div onClick={() => setMode("markdown")} ...>
  <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
</div>

// After — editable textarea, proportional font, same content state:
<textarea
  value={content}
  onChange={(e) => setContent(e.target.value)}
  placeholder="Start writing…"
  className="flex-1 resize-none bg-transparent px-8 py-6 text-base leading-8 ..."
/>
```

The forced mode-switch handlers on the title input were also removed:

```tsx
// Before:
onChange={(e) => { setTitle(e.target.value); if (mode === "document") setMode("markdown"); }}
onFocus={() => { if (mode === "document") setMode("markdown"); }}

// After:
onChange={(e) => setTitle(e.target.value)}
```

### What this changes

| | Before | After |
|---|---|---|
| Document mode | Read-only rendered HTML | Editable proportional textarea |
| Title input in Document mode | Switches to Markdown | Stays in Document mode |
| Markdown mode | Editable monospace ("AI source") | Unchanged |
| Content storage | Same markdown string | Unchanged |
| Autosave | Worked only in Markdown | Works in both modes |
| Mode switch | Forced on any interaction | Manual (user chooses) |

Both modes edit the same `content` string. Switching between them shows the
same text; no conversion happens. A user can write in Document mode and the
stored value is exactly what they typed.

The `renderMarkdown` call and import were removed since Document mode no longer
renders HTML.

---

## Problem 2: Stale sidebar tree

### What was wrong

`TreeSidebar` kept box tree data in a client-side `Map<boxId, BoxTreeData>`.
The tree was refreshed only when `currentBoxId` changed (user navigated to a box
page). This meant:

- Creating a note via `BoxQuickCreateMenu` → navigated to note page →
  `currentBoxId` became `undefined` → `useEffect([currentBoxId])` returned early →
  tree stayed stale (new note invisible until manual refresh).
- Creating a folder → `router.refresh()` triggered a full server re-render but
  the client-side tree data was NOT updated by that mechanism — the component
  re-mounted and the Map was rebuilt empty, requiring a re-expand to reload.
- Changes from another tab or user were never reflected.

### Fix: Supabase Realtime subscription

`TreeSidebar` now subscribes to `postgres_changes` for `notes`, `folders`, and
`boxes` filtered by the current workspace:

```ts
supabase
  .channel(`workspace-tree:${workspaceId}`)
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'notes', filter: `workspace_id=eq.${workspaceId}` },
    (payload) => handleContentChange(payload.new, payload.old)
  )
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'folders', filter: `workspace_id=eq.${workspaceId}` },
    (payload) => handleContentChange(payload.new, payload.old)
  )
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'boxes', filter: `workspace_id=eq.${workspaceId}` },
    () => router.refresh()
  )
  .subscribe();
```

**Note/folder changes** extract `box_id` from the payload and call a debounced
`fetchTree(boxId)` (300ms debounce coalesces burst events like template
application creating 3–5 notes at once). Only boxes that already have tree
data loaded (i.e., were previously expanded) are refreshed — collapsed boxes
are not pre-fetched.

**Box changes** call `router.refresh()` so the layout re-runs
`listBoxesByWorkspace()` and the server-rendered box list updates.

### Fix: Immediate QuickCreate sync

Waiting for the realtime event (typically 100–400ms + 300ms debounce = 400–700ms)
is fast enough for background sync but feels slow when you just created something
yourself. `BoxQuickCreateMenu` now calls a direct `fetchTree(box.id)` immediately
after a successful create via the `onTreeRefresh` callback:

```tsx
// In BoxQuickCreateMenu, after note creation:
onTreeRefresh?.(); // Starts fetchTree immediately
router.push(`/app/notes/${result.data.id}`); // Navigates concurrently
```

The tree fetch and navigation happen concurrently. By the time the user has
settled on the note page (layout + page load takes ~300–500ms), the tree data
for the box is already updated.

The same pattern applies to folder creation — `onTreeRefresh?.()` replaces
the previous `router.refresh()` which caused an expensive full server re-render.

### Stale-closure safety

The subscription handler runs in a `useEffect` closure. To avoid stale state:

- `treeDataRef` (ref synced to `treeData` state) — checked before deciding to
  refetch; avoids re-fetching trees that were never loaded.
- `boxIdsRef` (ref synced to the `boxes` prop) — checked to ensure the event
  is for this workspace's boxes, not a different workspace's.
- `realtimeDebounceRef` — stores pending debounce timers; cleared on unmount.
- `fetchTree` wrapped in `useCallback(fn, [])` — stable reference, safe to
  include in effect deps.
- `scheduleTreeRefetch` wrapped in `useCallback(fn, [fetchTree])` — also stable.

The subscription `useEffect` only re-runs when `workspaceId` changes (typically
never after login).

### workspaceId threading

`workspaceId` is now threaded from the server layout:

```
layout.tsx (server) → ctx.workspace.id
  → AppSidebar (prop: workspaceId)
      → TreeSidebar (prop: workspaceId)
  → MobileSidebar (prop: workspaceId)
      → TreeSidebar (prop: workspaceId)
```

If `workspaceId` is not provided (e.g., in tests or Storybook), the subscription
effect returns early and no channel is created. The component degrades gracefully.

---

## What was preserved

| Constraint | Status |
|---|---|
| Autosave (both modes) | Unchanged — both modes write to same `content` state |
| Note versioning (create_note_with_initial_version RPC) | Unchanged |
| Realtime security | Supabase RLS filters events server-side; filter param is defense-in-depth |
| Tree collapse/expand state | Preserved across realtime refreshes (only treeData Map updated) |
| Mobile sidebar | Same changes — also receives workspaceId |

---

## Deferred work

1. **Optimistic UI for QuickCreate**: Add the new note/folder to the local tree
   immediately on create (before the fetch completes) for zero-latency feedback.
   Requires managing optimistic + confirmed state carefully.

2. **On-note-page box auto-detection**: When the user lands directly on a note
   page (bookmark, shared URL) without having navigated from the box, the tree
   for that note's box isn't auto-expanded. The realtime subscription will keep
   it up to date once expanded, but auto-expanding the right box on note-page
   load would require a `noteId → boxId` reverse-lookup.

3. **Presence indicators**: Show a subtle indicator when another user/connection
   is actively editing a note. Requires a separate Supabase Realtime
   `broadcast` channel per note.
