# Remaining scope tracker (April 2026)

This tracker captures what is **still open** after the sidebar/skill/agent corrective pass.

## 1) Tree platform migration

Status: **Complete**

- Replaced custom `TreeSidebar` with `react-arborist` library.
- Sidebar tree uses react-arborist with custom node renderer for mixed types.
- Box contents tree tab also uses react-arborist.
- Preserved: mixed node types (folder/note/file/skill/agent), drag-drop reparenting,
  attachment semantics for reusable skills/agents.
- Server contract (`moveTreeNodeAction`) retained.
- Inline rename: double-click to rename, dispatches to type-specific server actions.
  Attachments cannot be renamed inline (they are references).
- Sidebar layout fixed: `overflow-hidden` on flex-1 container prevents tree from
  rendering behind bottom chrome section.
- Tree height estimation fixed: counts all descendant nodes, not just root items.

## 2) Graph expansion to full object topology

Status: **Complete**

- Graph includes all five object types as nodes: folders, notes, files, skills, agents.
- Uses **@xyflow/react** for interactive graph rendering.
- Uses **@dagrejs/dagre** for automatic hierarchical layout.
- Both note_links and object_links are rendered as edges.
- Read-only behavior and truncation safeguards preserved.
- Remaining: compound/grouped node rendering (folders as containment groups rather than nodes).

## 3) Realtime invalidation breadth + precision

Status: **Mostly complete**

- Completed:
  - workspace/library/box/folder/object scoped live refresh.
  - box page has WorkspaceLiveRefresh with `scope="box"` and `protectWhileEditing`.
  - workspaces page has WorkspaceLiveRefresh with `scope="workspace"`.
  - library pages (skills, agents) have WorkspaceLiveRefresh with `scope="library"`.
  - dirty-editor refresh deferral and queued flush behavior.
  - throttled refresh (500ms minimum interval between refreshes).
  - document visibility awareness (defers refresh when hidden).
  - tree sidebar uses scoped refetch per-box (not broad page refresh).
  - tree sidebar box-level changes throttled to 500ms.
- Remaining:
  - per-tab precision within box page tabs (currently refreshes whole box page).
  - server-side cache tagging strategy (still uses path-based invalidation).

## 4) Folder workspace parity

Status: **Complete**

- Dedicated folder route with full breadcrumb navigation.
- Right-side context panel with folder identity, stats, details.
- Folder lifecycle menu (archive/trash/restore) inline.
- Folder AI policy toggle.
- Content grid for all child types.
- Empty state with working actions.
- All five child creation actions.
- Folder export button.
- Rename inline from folder page and from tree sidebar.
- Remaining: folder-scoped search panel.

## 5) Skill and Agent multi-file structure

Status: **Complete**

- Skills:
  - Skill page restructured with tabs: Overview, Source, Files, History.
  - SkillChildrenPanel shown for all skills (box-local AND reusable).
  - Folder creation for box-local skills, file creation for all skills.
  - Clear separation: canonical source (Source tab) vs child files (Files tab) vs exports (menu).
- Agents:
  - Agent child creation dialogs fixed (were not rendering in empty state).
  - File and folder creation works and persists.
  - Folder creation requires box_id (box-local agents only).
- Remaining: true database-level containment via agent_id/skill_id FK on files/folders
  (currently uses object_links as structural foundation).

## 6) Sidebar and Settings

Status: **Complete**

- Sidebar `overflow-hidden` fix prevents tree overflow behind bottom chrome.
- Settings link always clickable regardless of tree expansion state.
- Tree height estimation counts all nodes (not just root items).

## 7) Documentation

Status: **Updated**

- `docs/architecture.md` — library choices, implementation status.
- `docs/remaining_scope_tracker.md` — this file.
- `docs/object_navigation_and_tree_integration_v1.md` — tree, DnD, rename, navigation.
- `docs/sidebar_settings_and_skill_structure_fix_v1.md` — bug analysis and fixes.
- `docs/graph_view_v1.md` — @xyflow/react, dagre, all object types.
- Remaining: `docs/design_system.md` needs tree/graph component documentation.
