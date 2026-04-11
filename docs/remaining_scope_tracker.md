# Remaining scope tracker (April 2026)

This tracker captures what is **still open** after the tree/graph/realtime/folder pass.

## 1) Tree platform migration

Status: **Complete**

- Replaced custom `TreeSidebar` with `react-arborist` library.
- Sidebar tree uses react-arborist with custom node renderer for mixed types.
- Box contents tree tab also uses react-arborist.
- Preserved: mixed node types (folder/note/file/skill/agent), drag-drop reparenting,
  attachment semantics for reusable skills/agents.
- Server contract (`moveTreeNodeAction`) retained — no migration needed.
- Remaining: react-arborist inline rename integration (currently uses external dialog).

## 2) Graph expansion to full object topology

Status: **Complete**

- Graph now includes all five object types as nodes: folders, notes, files, skills, agents.
- Uses **@xyflow/react** for interactive graph rendering.
- Uses **@dagrejs/dagre** for automatic hierarchical layout.
- Both note_links and object_links are rendered as edges.
- Edge types are visually distinct: hierarchy (smooth-step) vs semantic (animated bezier).
- Read-only behavior and truncation safeguards preserved.
- Remaining: compound/grouped node rendering (folders as containment groups rather than nodes).

## 3) Realtime invalidation breadth + precision

Status: **Mostly complete**

- Completed:
  - workspace/library/box/folder/object scoped live refresh.
  - dirty-editor refresh deferral and queued flush behavior.
  - throttled refresh (500ms minimum interval between refreshes).
  - document visibility awareness (defers refresh when hidden).
  - reduced polling frequency (5s instead of 2s).
  - tree sidebar uses scoped refetch per-box (not broad page refresh).
- Remaining:
  - per-tab precision within box page tabs (currently refreshes whole box page).
  - server-side cache tagging strategy (still uses path-based invalidation).

## 4) Folder workspace parity

Status: **Complete**

- Completed:
  - dedicated folder route with full breadcrumb navigation.
  - right-side context panel with folder identity, stats, details.
  - folder lifecycle menu (archive/trash/restore) inline on folder page.
  - folder AI policy toggle visible on folder page.
  - content grid for all child types: folders, notes, files, skills, agents.
  - empty state display when folder has no children.
  - all five child creation actions from folder page.
- Remaining:
  - folder-scoped search panel.
  - folder export button (currently only on box page).

## 5) Documentation parity sweep

Status: **Complete for this pass**

- Updated:
  - `docs/graph_view_v1.md` — full rewrite reflecting @xyflow/react, dagre, all object types.
  - `docs/remaining_scope_tracker.md` — updated to reflect completed work.
- Remaining:
  - `docs/architecture.md` — needs library choices section updated.
  - `docs/design_system.md` — needs tree/graph component documentation.
  - Other feature docs may have stale assumptions about graph-only-showing-notes.
