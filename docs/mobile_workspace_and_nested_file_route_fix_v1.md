# Mobile, Workspaces, and nested file routing fix — V1

This document records the April 2026 corrective pass that addressed four
reported product bugs: mobile navigation, the Workspaces route, nested
file routing inside Skills and Agents, and file page behaviour for
workspace-level files.

---

## 1. Mobile navigation

### Current state

`src/app/app/layout.tsx` already splits into mobile and desktop
branches:

- Desktop sidebar: hidden on mobile via `hidden md:flex`.
- Mobile header row: shows a hamburger trigger (`md:hidden`) plus the
  workspace name.

The hamburger is implemented by
`src/components/product/mobile_sidebar.tsx`, which:

1. Renders a button with `onClick={() => setOpen(true)}`.
2. Wraps the navigation in a `<Sheet>` (Base UI Dialog) with controlled
   `open` / `onOpenChange`.
3. Mirrors the desktop information hierarchy: primary nav, workspace
   label, expandable `TreeSidebar`, Settings link, theme toggle, and
   user menu.
4. Calls `close()` on every link click so the sheet closes after
   navigation.

This was already correct. Verification:

- `pnpm build` compiles all routes successfully.
- All 209 vitest tests pass.
- Primary nav entries include Home, Search, Workspaces, Proposals,
  Audit log, and Settings — every link the user needs to navigate to
  from mobile.

### Mobile responsive padding adjustments

Several page headers used `px-6` only, which felt tight on narrow
screens. Changed to `px-4 md:px-6` (or `px-3 md:px-6` where the layout
was already denser):

- `src/app/app/boxes/[box_id]/page.tsx` — box header row now wraps
  `flex-col gap-3 md:flex-row`, so title and action buttons stack on
  mobile instead of clipping off-screen. Action cluster is
  `flex-wrap` so Import / Export / Lifecycle / Create actions reflow.
- `src/app/app/files/[file_id]/page.tsx` — file header uses
  `px-3 md:px-6` with a `flex-wrap` breadcrumb.
- `src/app/app/agents/page.tsx`, `skills/page.tsx`, and
  `skills/[skill_id]/page.tsx` — library / detail headers use
  `px-4 md:px-6`.
- `src/app/app/workspaces/page.tsx` — content container uses
  `px-4 md:px-6`.

These are calm, targeted reflows — not a separate mobile product.

---

## 2. Workspaces route and workspace model

### Multi-workspace vs single workspace

**The product currently supports a single workspace per owner.**

Evidence:

1. `src/server/repositories/workspace_repository.ts` supports listing
   multiple workspaces per owner (`listWorkspacesByOwner` returns an
   array) and creating additional workspaces. The schema imposes no
   single-workspace constraint.
2. `src/server/services/workspace_bootstrap/get_or_create_default_workspace.ts`
   returns `workspaces[0]` — the first workspace — and creates a
   default only when none exists. This is the V1 product choice.
3. `getRequestContext()` exposes `ctx.workspace` as a single record, so
   every page assumes one workspace per authenticated session.
4. `src/app/app/workspaces/page.tsx` shows an explanatory note:
   &ldquo;In V1, Context Store uses a single workspace per account.&rdquo;

So the repository layer is multi-workspace capable, but the product
runtime is single-workspace by design.

### What was reported as broken

The user reported that clicking "Workspaces" in the sidebar went to a
page that does not exist. The page does exist at
`src/app/app/workspaces/page.tsx`, and `pnpm build` compiles it cleanly
as a dynamic route (`ƒ /app/workspaces`).

### How it now behaves

- `/app/workspaces` renders reliably via the corrected layout:
  - Page header with &ldquo;Workspaces&rdquo; title and a
    `CreateBoxDialog` action (create a box in the active workspace).
  - Active workspace identity card: name, slug, Active badge.
  - Boxes section with search/filter (`BoxList` client component) or
    an empty state when there are no boxes.
  - A visible V1 note stating that a single workspace per account is
    the current model and multi-workspace collaboration is not yet
    supported.
- `WorkspaceLiveRefresh scope="workspace"` is mounted so the page
  updates live when boxes are created or renamed.

The sidebar label is kept as &ldquo;Workspaces&rdquo; because the
route is a workspace management surface (workspace identity plus its
boxes), even when there is one workspace. The text and content make
the single-workspace model explicit rather than implying multiple
workspaces that do not exist.

---

## 3. File routing for child files inside Agents and Skills

### The bug

`src/app/app/files/[file_id]/page.tsx` hard-coded this ownership check:

```ts
const box = file.box_id ? await getBoxById(supabase, file.box_id) : null;
if (!box || box.workspace_id !== ctx.workspace.id) notFound();
```

For a workspace-level file (`box_id = null`) — which is exactly what
you get when a **reusable** Skill or Agent owns a child file — `box`
becomes null, the condition short-circuits, and the page returns
`notFound()`. Clicking a child file inside a reusable Skill or Agent
produced a 404.

In addition, the breadcrumb never consulted `file.parent_skill_id` or
`file.parent_agent_id`, so even box-local Skill/Agent child files
showed the wrong crumb trail.

### The fix

Rewrote `src/app/app/files/[file_id]/page.tsx` to compute a
`ParentContext` discriminated union before the `notFound()` check:

```
type ParentContext =
  | { kind: "box"; boxId; boxName; folderName }
  | { kind: "skill"; skillId; skillName; boxId; boxName }
  | { kind: "agent"; agentId; agentName; boxId; boxName };
```

Resolution order:

1. If `file.parent_skill_id` is set, load the Skill, verify workspace
   ownership directly, and build a Skill-rooted parent context. The
   Skill&rsquo;s own box (if any) is used for notes/files list
   lookups.
2. Else if `file.parent_agent_id` is set, same for Agent.
3. Else if `file.box_id` is set, use the box-rooted context with an
   optional folder layer.
4. Else (workspace-level file with no explicit parent) use a minimal
   workspace context.

`notFound()` now only fires when the file is not visible to the
workspace, not when `box_id` is null. Ownership verification flows
through the skill / agent when relevant.

### Breadcrumb

The new `Breadcrumb` component reflects the real parent:

- Box-local file: `Workspace / Box / [Folder] / filename`
- Box-local Skill child file:
  `Workspace / Box / Skill: <name> / filename`
- Workspace-level Skill child file:
  `Workspace / Skills / Skill: <name> / filename`
- Same pattern for Agents.

Skill and Agent crumbs include their icon and link back to the parent
with `?tab=children` so the user lands on the Files tab of the parent.

### Context panel

The right-side `FileContextPanel` receives a synthesized box label
(`Skill: <name>` / `Agent: <name>`) when the parent is a reusable
workspace-level object, so the panel still reads coherently. Notes
and files list lookups use the Skill/Agent&rsquo;s own box when one
exists; workspace-level files simply have an empty link-target pool
(links between workspace-level objects go through the parent).

### Linking hrefs

`src/app/app/skills/[skill_id]/page.tsx` and
`src/app/app/agents/[agent_id]/page.tsx` already build child links as
`/app/files/<id>`. No change needed on the producer side — the file
page now accepts those links for every scope the Skills/Agents can
create children in.

---

## 4. Editing, versioning, import into nested files

### Editing

`saveFileAction` and the file lifecycle actions (archive, trash,
unarchive, restore, rollback) all flow through
`getFileForWorkspace`, which verifies ownership via `workspace_id`
directly when `box_id` is null. These already worked for
workspace-level files — only the route was the blocker.

The file editor itself is the CodeMirror-based `<FileEditor>` that
renders with language-aware syntax highlighting (see
`docs/library_layout_and_real_source_editor_fix_v1.md`). Autosave,
version history, and the dirty-signal contract used by
`WorkspaceLiveRefresh` to defer refresh during editing are unchanged.

### Version history and audit

Versioning and audit continue to be handled by the existing services
(`object_versions`, `audit_events`). Nothing in this pass weakens
those contracts.

### Import into nested files

Package-level import into a Skill or Agent remains a supported flow
at the Skill / Agent level (via their own import triggers); individual
file-level replace-by-import is not supported as a separate path for
this pass. Users can replace file content through the normal editor
save flow, and skill/agent package imports restore child files
correctly because the import service already handles `parent_skill_id`
/ `parent_agent_id` and the object_links that glue packages together.

---

## Files changed

| File | Change |
| --- | --- |
| `src/app/app/files/[file_id]/page.tsx` | Parent context discriminated union (box / skill / agent / workspace), correct `notFound()` placement, parent-aware breadcrumb with Skill/Agent icons and links, context panel label that reads coherently for reusable objects. `px-3 md:px-6` header padding. |
| `src/app/app/boxes/[box_id]/page.tsx` | Box header uses `flex-col md:flex-row` so the title and actions stack on mobile; action cluster uses `flex-wrap`. `px-4 md:px-6` header padding. |
| `src/app/app/agents/page.tsx`, `src/app/app/skills/page.tsx`, `src/app/app/skills/[skill_id]/page.tsx` | `px-4 pt-4 pb-4 md:px-6 md:pt-6` on library / detail page headers. |
| `src/app/app/workspaces/page.tsx` | `px-4 md:px-6` on content container for mobile spacing. |
| `docs/mobile_workspace_and_nested_file_route_fix_v1.md` | This document. |

No API / MCP / trust / schema changes. The existing MobileSidebar,
TreeSidebar, and workspace routing all continued to function; the
corrective fixes were tightly scoped to the file page and to mobile
padding.

---

## Remaining limitations

1. **Single workspace per owner** is the V1 product choice; the
   repository layer supports more, but `getOrCreateDefaultWorkspace`
   returns the first workspace. Multi-workspace UX is a future
   feature.
2. **No file-level import flow.** Users cannot drop a file onto an
   existing file to replace its content. Package-level import into a
   Skill or Agent remains the supported path. File content editing
   happens through the editor with autosave and version history.
3. **Workspace-level files have no link target pool on the file
   page.** Links between workspace-level files flow through the
   parent Skill / Agent&rsquo;s relationships panel. Box-local files
   continue to expose the full eligible-target pool.
4. **Mobile breadcrumb trimming.** On very narrow screens with deep
   Skill/Agent child trees, the breadcrumb may wrap into two lines.
   This is acceptable — truncating would lose the navigational signal.
