# Sidebar, Settings, and Skill structure fix — V1

This document records the bugs found and fixes applied in the April 2026
corrective passes. It is the authoritative reference for what was broken
and how the fixes are structured today.

---

## 1. Sidebar layout overflow

### What was broken

The sidebar&rsquo;s middle flex-1 container for tree content
(`flex min-h-0 flex-1 flex-col`) was missing `overflow-hidden`. When boxes
were expanded and the tree grew taller than the available space, tree
rows rendered **behind** the bottom chrome section (Settings link, theme
toggle, user menu), obscuring it visually and intercepting pointer events.

### Root cause

`min-height: 0` on a flex child lets it shrink below its content height,
but without `overflow: hidden` on the same element, the rendered child
tree still painted outside the computed box. The bottom chrome was
positioned correctly but was painted under the overflowing tree rows.

### Fix

Added `overflow-hidden` to the flex-1 tree container in
`src/components/product/app_sidebar.tsx`:

```tsx
<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
  {/* boxes label + ScrollArea with TreeSidebar */}
</div>
```

The ScrollArea inside handles internal scrolling when the tree exceeds the
available height. The bottom chrome is a sibling div and is never
overlapped.

### How it now behaves

- Any number of expanded boxes keeps the tree within its designated area.
- The ScrollArea scrolls when content exceeds the available height.
- The bottom chrome (Settings, theme toggle, user menu) remains visible
  and clickable at every viewport size.

---

## 2. Settings click behavior

### What was broken

The Settings icon in the sidebar bottom chrome appeared unresponsive when
boxes were expanded.

### Root cause

Same layout overflow bug as #1. Tree content rendered over the Settings
button, intercepting clicks before they reached the `<Link>` element.

### Fix

Fixed by the same `overflow-hidden` addition. The Settings link
(`<Link href="/app/settings">`) was always correctly implemented — the
issue was purely layout overflow, not a broken route.

### How it now behaves

Settings is always clickable regardless of tree expansion state. It
navigates to `/app/settings`, which renders the Settings page without
error.

---

## 3. Agent child file and folder creation

### What was broken

Clicking "Folder" or "File" in the Agent Children tab did nothing when
the agent had no existing children (empty state).

### Root cause

In `AgentChildrenPanel`, when `structuralLinks.length === 0` the component
returned early with the empty-state UI **before** rendering the create
Dialog components. The buttons set `folderOpen` / `fileOpen` state to
true, but no Dialog existed in the DOM to respond.

### Fix

Moved the Dialog components **outside** the conditional return so they
are always mounted. Empty state and populated state share the same
Dialog instances. Added error display inside the dialogs. See
`src/components/product/agent_children_panel.tsx` lines 160–209 (the
comment at the top of the Dialog block documents the fix).

### How it now behaves

- Clicking Folder or File opens the create dialog in every state
  (empty, populated, reusable, box-local).
- Submitting the form calls `createAgentChildFolderAction` /
  `createAgentChildFileAction` server actions.
- Created children appear immediately via `router.refresh()`.
- Children persist across refresh and across navigation.
- Agent context is preserved: the child&rsquo;s `parent_agent_id` FK is
  set, and an `object_links` row of type `parent_of` is created.

---

## 4. Folder creation works for reusable Skills and Agents

### What was broken

The prior fix still left a structural gap: child folders could only be
created for **box-local** Skills and Agents because the `folders.box_id`
column was `NOT NULL`. Reusable workspace-level Skills and Agents
(`box_id = null`) could not own folders.

### Root cause

Database schema constraint: `folders.box_id uuid NOT NULL` meant every
folder had to belong to a box, even though reusable Skills and Agents
exist at the workspace level without any box context.

### Fix (DB migration + service + action updates)

Migration `supabase/migrations/20260412000001_skill_agent_child_containment.sql`:

1. Added `workspace_id uuid NOT NULL` to `folders` (back-populated from
   `boxes.workspace_id` for existing rows).
2. Made `folders.box_id` nullable.
3. Added `parent_skill_id` and `parent_agent_id` FK columns to both
   `files` and `folders`, nullable with `ON DELETE SET NULL`.
4. Indexed the new FK columns.
5. Added RLS policies for workspace-level folders (box_id IS NULL),
   scoped via `workspace_id` direct ownership.

`src/server/services/folder_service.ts` — `createFolder` now accepts
nullable `boxId` and forwards `parent_skill_id` / `parent_agent_id`.

`src/app/app/skills/actions.ts` and `src/app/app/agents/actions.ts` —
the child folder actions no longer reject reusable objects. They set
`parent_skill_id` / `parent_agent_id` on the created folder and create
the `object_links` row.

### How it now behaves

- Reusable workspace Skills can create child folders and files.
- Reusable workspace Agents can create child folders and files.
- Box-local Skills and Agents continue to create children inside their
  owning box.
- Children persist across refresh; the direct FK column and the
  `object_links` row are both maintained for fast lookup and
  heterogeneous linking.

---

## 5. Skill page is now a real package workspace

### What was broken

Skills were rendered as single-file summary pages. The previous layout
had four stacked sections (details, canonical source, version history,
lifecycle) and no dedicated surface for supporting files or nested
folders. The `SkillChildrenPanel` existed but was gated by
`!skill.is_reusable && skill.box_id`, hiding it for all reusable Skills.

### Fix

1. Removed the reusable guard. `SkillChildrenPanel` renders for every
   Skill.
2. Restructured the Skill page (`src/app/app/skills/[skill_id]/page.tsx`)
   into four tabs:
   - **Overview** — trust header, machine provenance, metadata
     (format, status, scope, tags, created), lifecycle controls.
   - **Source** — canonical editable source file in a real source
     editor. Copy makes clear this is the single canonical source.
   - **Files** — `SkillChildrenPanel` listing child folders and files,
     with working Add Folder and Add File buttons.
   - **History** — version timeline with rollback for the canonical
     source only.
3. Export menu is in the page header and produces signed-URL zip
   downloads.

### Canonical source vs child files vs exports

Three **structurally distinct** concepts:

| Surface | Storage | Editable? | Count |
| --- | --- | --- | --- |
| Canonical source | `skills.source_content` + `object_versions` | Yes, in Source tab | Exactly one per Skill |
| Child files / folders | `files` / `folders` tables with `parent_skill_id` + `object_links` | Yes, each child editable | Unbounded |
| Exports | Generated on demand; signed URL; not persisted | No, read-only | Unbounded (one per export call) |

See `docs/skills_object_and_editor_v1.md` for the full object model.

---

## 6. Tree height estimation

### What was broken

The react-arborist tree height was computed as
`Math.min(treeData.length * 120, 600)`. This over-estimated for small
trees, under-estimated for large ones, and capped at 600px so deep
trees had their bottom rows cut off.

### Fix

Changed to count **initially visible** nodes (root items plus their
open descendants) using the `initialOpenState` map, multiplied by the
real row height plus padding, and removed the cap. The outer ScrollArea
handles overflow if the computed height exceeds the available space.

```ts
function countVisibleNodes(nodes, openState) {
  let count = nodes.length;
  for (const n of nodes) {
    if (n.children && openState[n.id]) {
      count += countVisibleNodes(n.children, openState);
    }
  }
  return count;
}
const estimatedHeight = Math.max(
  countVisibleNodes(treeData, initialOpenState) * 28 + 20,
  80,
);
```

---

## 7. Sticky legal footer z-index

### What was broken

`LegalStickyFooter` (rendered below `<main>` in the authenticated app
layout) used `z-10`. That sat below page-level sticky subheaders (which
can use `z-20`), and could be painted under scrolling content in some
corner cases.

### Fix

Changed the footer&rsquo;s z-index to `z-30` and added `shrink-0` to
prevent flex-layout distortion. `z-30` keeps the legal bar above
regular page content and page sticky subheaders, while still sitting
safely below dropdowns (`z-50`) and modal dialogs (`z-50`) so those
overlay it correctly.

---

## Files changed across all passes

| File | Change |
| --- | --- |
| `src/components/product/app_sidebar.tsx` | Added `overflow-hidden` to flex-1 tree container |
| `src/components/product/tree_sidebar.tsx` | Fixed tree height estimation to count open descendants |
| `src/components/product/agent_children_panel.tsx` | Moved Dialogs outside conditional return, added error state |
| `src/components/product/skill_children_panel.tsx` | Added `canCreateFolders` prop, error display, folder/file grouping |
| `src/app/app/skills/[skill_id]/page.tsx` | Restructured to tabs (Overview/Source/Files/History), removed is_reusable guard |
| `src/app/app/agents/[agent_id]/page.tsx` | Tabs include Children; empty states use working buttons |
| `src/app/app/skills/actions.ts` | `createSkillChildFolderAction` no longer blocks reusable Skills; sets `parent_skill_id` FK; `createSkillChildFileAction` sets FK too |
| `src/app/app/agents/actions.ts` | `createAgentChildFolderAction` and `createAgentChildFileAction` set `parent_agent_id` FK; no reusable block |
| `src/server/services/folder_service.ts` | `createFolder` accepts nullable `boxId`, forwards `parent_skill_id` / `parent_agent_id`, validates workspace ownership directly for workspace-level folders |
| `src/server/repositories/folder_repository.ts` | `CreateFolderInput` updated for new columns |
| `src/server/domain/types/folder.ts` | `box_id: string | null`; added `workspace_id`, `parent_skill_id`, `parent_agent_id` |
| `src/server/domain/types/file.ts` | Added `parent_skill_id`, `parent_agent_id` |
| `supabase/migrations/20260412000001_skill_agent_child_containment.sql` | New migration: workspace_id on folders, nullable box_id, parent FK columns, indexes, RLS |
| `src/components/legal/legal_modal.tsx` | z-index on sticky footer raised to `z-30` with `shrink-0` |
| `docs/skills_object_and_editor_v1.md` | New doc: Skill object model, storage, actions, invariants |
| `docs/sidebar_settings_and_skill_structure_fix_v1.md` | This document |
