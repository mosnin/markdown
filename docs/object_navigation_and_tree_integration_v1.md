# Object navigation and tree integration — V1

This document describes how the sidebar tree, box contents tree, and navigation
work across all object types.

---

## Tree library

The tree is implemented with **react-arborist** v3, which provides:
- Virtualized rendering via react-window
- Built-in drag-and-drop via react-dnd
- Keyboard navigation (arrow keys, Home/End, Page Up/Down)
- Inline rename (Enter key or double-click)
- ARIA accessibility

---

## Sidebar tree (`TreeSidebar`)

File: `src/components/product/tree_sidebar.tsx`

### Structure

```
TreeSidebar
  └── BoxRow (per box — not part of react-arborist tree)
        ├── Box header (link + expand toggle + quick-create menu)
        └── BoxTree (react-arborist Tree component)
              └── TreeNode (custom node renderer)
```

Each box has its own react-arborist `Tree` instance. Box rows are outside
the tree — they manage expand/collapse at the box level and lazy-load tree
data via `getBoxTreeAction`.

### Node types

All five object types are rendered as `TreeNodeData` nodes:

| Type | Icon | Suffix | Navigate to |
|---|---|---|---|
| Folder | Folder01/02Icon (hugeicons) | — | `/app/folders/{id}` |
| Note | FileText/BookOpen/Package (lucide) | `.md` | `/app/notes/{id}` |
| File | File (lucide) | file extension | `/app/files/{id}` |
| Skill | Zap (lucide) | `↗` if attached | `/app/skills/{id}` |
| Agent | Bot (lucide) | `↗` if attached | `/app/agents/{id}` |

Reusable attached skills and agents link with `?box_id=` query param.

### Drag and drop

- `onMove` handler dispatches to `moveTreeNodeAction` server action
- `disableDrop` prevents drops onto non-folder nodes and circular folder moves
- Root-level drops set `position: "root"` and `targetFolderId: null`
- Folder drops set `position: "inside"` and `targetFolderId` to the folder's object ID

### Inline rename

- Double-click a node's name label to enter edit mode
- Press Enter or blur to submit, Escape to cancel
- `disableEdit` is set for attachment nodes (cannot rename references)
- `onRename` dispatches to type-specific actions:
  - `renameNoteAction(id, name)` from `tree_actions.ts`
  - `renameFolderAction(id, name)` from `tree_actions.ts`
  - `renameFileAction(id, name)` from `tree_actions.ts`
  - `renameSkillAction(id, name)` from `tree_actions.ts`
  - `renameAgentAction(id, name)` from `tree_actions.ts`

### Realtime updates

TreeSidebar subscribes to Supabase Realtime on a per-workspace channel:
- Content table changes (notes, folders, files, skills, agents, box_object_attachments)
  trigger debounced refetch of the affected box's tree data (300ms coalesce).
- Box table changes (name, status) trigger a throttled full layout refresh (500ms).
- Only expanded boxes with loaded tree data are refetched.

### Quick-create menu

Each box row has a `+` button that opens a dropdown menu with:
- New note, New folder, New file, New agent, Attach reusable

---

## Box contents tree (`BoxContentsTree`)

File: `src/components/product/box_contents_tree.tsx`

Used in the "Tree" tab on the box page. Read-only mode (drag/drop/edit disabled).
Shows folders and notes only (simpler than sidebar tree).

---

## Tree data flow

```
getBoxTreeAction(boxId)
  ↓
Flat data: { folders[], notes[], files[], skills[], agents[] }
  ↓
buildArboristTree(data) → TreeNodeData[]
  ↓
react-arborist Tree component
  ↓
TreeNode renderer (custom per-node rendering)
```

### ID scheme

react-arborist node IDs are prefixed with the object type to avoid potential
collisions across tables: `folder:{uuid}`, `note:{uuid}`, `file:{uuid}`, etc.
The actual database ID is stored in `TreeNodeData.objectId`.

---

## Navigation routes

| Object | Route | Activated by |
|---|---|---|
| Box | `/app/boxes/{id}` | Box header click |
| Folder | `/app/folders/{id}` | Folder node click |
| Note | `/app/notes/{id}` | Note node click |
| File | `/app/files/{id}` | File node click |
| Skill | `/app/skills/{id}` | Skill node click |
| Agent | `/app/agents/{id}` | Agent node click |
| Workspaces | `/app/workspaces` | "Boxes" label in sidebar |

Active node highlighting uses pathname comparison against the node's route.

---

## Rules for future prompts

1. react-arborist is the tree library — do not replace with a custom implementation.
2. Box rows are not part of react-arborist — they wrap individual Tree instances.
3. Node IDs must be prefixed with type (`folder:`, `note:`, etc.).
4. Inline rename must remain disabled for attachment nodes.
5. Drag-drop must validate via `disableDrop` — only folders and root accept children.
6. Tree data comes from `getBoxTreeAction` — do not add new data fetching.
7. Realtime updates must remain scoped per-box, not broad page refresh.
