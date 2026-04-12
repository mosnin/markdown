# Sidebar, Settings, and Skill structure fix — V1

This document records the bugs found and fixes applied in the April 2026 corrective pass.

---

## 1. Sidebar layout overflow

### What was broken

The sidebar flex-1 container for the tree content area (`flex min-h-0 flex-1 flex-col`) was
missing `overflow-hidden`. When boxes were expanded and tree content exceeded the available
height, items rendered behind the bottom chrome section (Settings + theme toggle + user menu).

### Root cause

The CSS `min-height: 0` on the flex container allows flex children to shrink, but without
`overflow: hidden` on the container itself, overflowing content was still visually painted
beyond the container's computed height. The bottom chrome section (a separate sibling div)
was rendered at the correct position but tree content appeared behind it.

### Fix

Added `overflow-hidden` to the flex-1 container wrapping the ScrollArea:
```
<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
```

This ensures any content exceeding the container's computed height is clipped. The ScrollArea
inside handles scrolling for the tree content.

### How it now behaves

- Expanding any number of boxes keeps the tree content within its designated area
- The ScrollArea scrolls when content exceeds the available height
- The bottom chrome section (Settings, theme toggle, user menu) remains visible and clickable
- Works at all viewport heights including compact laptop screens

---

## 2. Settings click behavior

### What was broken

The Settings icon in the bottom chrome section appeared unresponsive when boxes were expanded
in the sidebar tree.

### Root cause

Same as the sidebar layout overflow bug. Tree content was rendering behind the bottom chrome
section, creating an invisible overlay that intercepted pointer events before they reached
the Settings link.

### Fix

Fixed by the same `overflow-hidden` addition. The Settings link (`<Link href="/app/settings">`)
was always correctly implemented — the issue was purely layout overflow.

### How it now behaves

Settings is always clickable regardless of tree expansion state. Navigates to `/app/settings`.

---

## 3. Agent child file/folder creation

### What was broken

Clicking "Folder" or "File" buttons in the Agent Children tab did nothing when the agent had
no existing children (empty state).

### Root cause

In `AgentChildrenPanel`, when `structuralLinks.length === 0`, the component returned early
with the empty state UI. The `<Dialog>` components for folder and file creation were defined
AFTER the conditional return (lines 171-209), so they were never rendered in the DOM. Clicking
the buttons set `folderOpen` or `fileOpen` state to true, but no Dialog existed to display.

### Fix

Restructured the component to always render Dialog components by moving them outside the
conditional return. The empty state and populated state now share the same Dialog instances.
Added error state display in the dialogs.

### How it now behaves

- Clicking "Folder" opens the folder creation dialog (for box-local agents)
- Clicking "File" opens the file creation dialog
- Created children appear immediately after creation via `router.refresh()`
- The created objects persist across refresh
- For reusable workspace agents without box_id, folder creation shows an error message
  (folders require a box_id in the data model)

---

## 4. Skill multi-file package structure

### What was broken

Skills were treated as single-file objects. The Skill page only showed:
- Details
- Canonical source
- Version history
- Lifecycle controls

The `SkillChildrenPanel` was hidden for all reusable workspace-level skills
(`!skill.is_reusable && skill.box_id` guard), and the page had no tabs or
structural separation.

### Fix

1. **Removed the guard**: `SkillChildrenPanel` now renders for ALL skills, not just box-local ones.
2. **Added tabs**: Skill page now uses a tabbed interface with four tabs:
   - **Overview**: Trust header, provenance, metadata details, lifecycle controls
   - **Source**: Canonical source editor with explanatory text
   - **Files**: `SkillChildrenPanel` with create actions for supporting files and folders
   - **History**: Version timeline with rollback
3. **Folder/file separation**: Folders are only creatable for box-local skills (since folders
   require box_id). Files can be created for both box-local and reusable skills.
4. **Updated `SkillChildrenPanel`**: Added `canCreateFolders` prop, error display, better
   empty state, and visual separation of folders vs files in the list.

### How canonical source vs child files vs exports are separated

| Surface | What it contains | Editable? |
|---|---|---|
| **Source tab** | Exactly one canonical editable source file | Yes (via SkillSourceEditor) |
| **Files tab** | Supporting child files and nested folders | Yes (create/navigate) |
| **Export menu** | Read-only generated export packages | No (download only) |

The canonical source is the skill's `source_content` field. Child files are separate
`files` and `folders` records linked via `object_links` with `relationship_type = "parent_of"`.
Exports are generated zip packages containing the canonical source plus all linked content.

---

## 5. Tree height estimation

### What was broken

The react-arborist tree height was calculated as `Math.min(treeData.length * 120, 600)`, which
only counted root-level items and capped at 600px. Trees with many expanded folders could
have their bottom items cut off.

### Fix

Changed to count all nodes recursively: `countAllNodes(treeData) * 28 + 20`. This gives each
node exactly its row height (28px) plus padding. No cap — the ScrollArea handles overflow.

---

## Files changed

| File | Change |
|---|---|
| `src/components/product/app_sidebar.tsx` | Added `overflow-hidden` to flex-1 container |
| `src/components/product/agent_children_panel.tsx` | Moved Dialogs outside conditional return |
| `src/components/product/skill_children_panel.tsx` | Added `canCreateFolders` prop, error state, folder/file grouping |
| `src/app/app/skills/[skill_id]/page.tsx` | Added tabs (Overview/Source/Files/History), removed is_reusable guard |
| `src/components/product/tree_sidebar.tsx` | Fixed tree height estimation |
