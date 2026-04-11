# Remaining scope tracker (April 2026)

This tracker captures what is **still open** after the recent object-model/tree/realtime iterations.

## 1) Tree platform migration

Status: **Not started**

- Replace custom `TreeSidebar` interaction layer with `react-arborist`.
- Preserve existing behavior:
  - mixed node types (folder/note/file/skill/agent),
  - drag/drop reparenting + before/after placement,
  - attachment semantics for reusable skills/agents,
  - optimistic UI + rollback on move failures.
- Keep current server contract (`moveTreeNodeAction`) until a dedicated migration is approved.

## 2) Graph expansion to full object topology

Status: **Not started**

- Current graph is BoxOverview folders/notes/note-links only.
- Add files/skills/agents as first-class graph nodes.
- Add object-link edges where semantically valid.
- Keep read-only behavior and truncation safeguards.

## 3) Realtime invalidation breadth + precision

Status: **Partially complete**

- Completed:
  - workspace/library/folder/object scoped live refresh.
  - dirty-editor refresh deferral and queued flush behavior.
- Remaining:
  - per-tab precision (avoid refreshing unrelated side panels),
  - server-side cache tagging strategy to reduce broad route refreshes.

## 4) Folder workspace parity

Status: **Partially complete**

- Completed:
  - dedicated folder route and child listing.
  - folder rename + create-in-folder entrypoints.
- Remaining:
  - richer inline lifecycle controls parity with box/note/file surfaces,
  - deeper context panes equivalent to other object pages.

## 5) Documentation parity sweep

Status: **In progress**

- Completed:
  - `docs/architecture.md`, `docs/design_system.md`, `docs/graph_view_v1.md` updated with explicit gaps.
- Remaining:
  - apply the same status annotations to other architecture-adjacent docs where old assumptions remain.

