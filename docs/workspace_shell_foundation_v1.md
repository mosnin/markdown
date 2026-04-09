# Workspace shell foundation — V1

This document describes the workspace shell and information architecture implemented in
the workspace layout pass. It covers the three-pane model, sidebar tree principles,
box and note surface foundations, and the rules later prompts must preserve.

See also: [docs/workspace_layout_correction_v1.md](workspace_layout_correction_v1.md)
for the complete implementation reference including component inventory.

---

## Three-pane workspace model

The app uses a persistent three-pane layout on desktop (lg+):

```
[left sidebar 240px] | [center pane flex-1] | [right context pane 288px]
```

**Left sidebar** — persistent on desktop, sheet drawer on mobile.
Houses workspace identity, primary navigation, and the nested box tree.

**Center pane** — the primary working surface. All meaningful work happens here:
- Note editor (note pages)
- Box content (box pages)
- Workspace cockpit (home page)

**Right context pane** — supplementary context, visible at lg+.
Embedded in page components, not in the shell. The shell stays thin; pages own
their panel space. Contains: note metadata, semantic links, version entry points,
context bundle, history (note pages); guide picker, stats, folder policies (box pages).

### Mobile

On mobile (< md), the left sidebar is replaced by a top bar with a hamburger button
that opens a full-height sheet (`MobileSidebar`). The right pane is hidden on mobile;
its content is accessible via right-panel tabs in the note and box pages.

---

## Left sidebar tree principles

The sidebar is the **primary structure and navigation surface**. It is not a secondary
tab or a supplementary panel — it is the persistent anchor of the workspace.

### What the sidebar shows

1. Workspace identity (name + logo mark)
2. Primary navigation (Home, Workspace, Proposals, Audit log)
3. Workspace label with quick-create affordance
4. Expandable box tree: boxes → folders → notes, multiple levels deep
5. Settings and user menu at the bottom

### Tree behavior

**Expand/collapse** — clicking the chevron expands or collapses a box entry. Clicking
the box name navigates to `/app/boxes/[id]`.

**Lazy loading** — tree data (folders + notes) is fetched via `getBoxTreeAction` the
first time a box is expanded. Data is cached in component state for the session.

**Auto-expand** — when the current URL is `/app/boxes/[id]` or `/app/notes/[id]`,
the relevant box auto-expands on mount if not already expanded.

**Active highlighting** — the current note entry gets `bg-sidebar-accent` styling.
The active box entry is also highlighted as "current".

**Icons by kind:**
- `note` → FileText
- `guide` → BookOpen
- `bundle` → Package

**Empty states** — "No content yet." when a box has no content; link to create the
first box when no boxes exist.

### Tree implementation

- `TreeSidebar` (client component) — receives `boxes`, `currentBoxId`, `currentNoteId`
- `AppSidebar` extracts `currentBoxId` and `currentNoteId` from pathname using regex
- `MobileSidebar` uses the same `TreeSidebar` with `onNavigate={close}`
- `getBoxTreeAction` (server action in `src/app/app/boxes/actions.ts`) — fetches
  folders and notes for a box after verifying workspace ownership

---

## Box as primary operating surface

The box page is the main context workbench for a box. It should not feel like a loose
route with utility tabs.

### Above the fold (always visible)

- Workspace name (breadcrumb eyebrow)
- Box name (h1)
- Box description (if set)
- Guide note status: linked guide note title (linked) or "No guide note set" message
- Action bar: import, export, lifecycle, create folder, create note

### Tab structure

| Tab | Purpose |
|---|---|
| Notes | Sorted list of active notes (most recent first) |
| Tree | Full folder/note hierarchy with lifecycle menus |
| Guide | Structured box interpretation (guide note, top notes, tags) |
| Graph | Read-only hierarchy + link edge visualization |
| Search | Full-text note search |
| Archived | Archived notes and folders (shown only if any exist) |
| Trash | Trashed notes and folders (shown only if any exist) |

---

## Note as note plus context

The note page embeds the note in a structured system — it is not just an editor screen.

### Center pane

- Breadcrumb bar (workspace → box → folder → note)
- NoteEditor with Document mode as the default (reading experience first)
- Three mode toggle: Document (rendered) / Edit (markdown textarea) / Source (raw)
- Source mode is labeled explicitly as "what the AI model receives — unmodified source"

### Right context pane — tabs

| Tab | Contents |
|---|---|
| Info | Kind, guide status, tags, location, version, summary, read hint |
| Links | Context relationships (SemanticLinksPanel) |
| Bundle | Context bundle viewer |
| History | Version history and rollback |

### Autosave

Autosave fires 1500ms after the last keystroke. Every save calls the same
`saveNoteAction` path as manual save, creating an immutable version via
`update_note_and_create_version` RPC. Autosave never weakens versioning.

---

## Workspace home (cockpit)

The workspace home (`/app`) is a cockpit entry point, not a dashboard of charts.

Structure:
1. Workspace header — name, "Create box" action
2. Status row — four tiles: boxes, recent notes, active connections, pending proposals
3. Recent notes — up to 10 most-recently-updated notes across all boxes
4. Boxes — card grid linking to each box, with description and guide status
5. Active connections — summary of connections with workspace access
6. Pending proposals — callout when AI write proposals need review

Status tiles are functional (linked to relevant pages), not vanity metrics.

---

## Sense of place

Every surface reinforces the product mental model:

```
workspace → box → folder → note
```

- Breadcrumb bars on note and box pages show the full path
- The sidebar highlights the current box and note
- The workspace home always shows the workspace name
- Route transitions feel like movement within one environment, not page hops

---

## Shell architecture rules

These rules must be preserved by all future prompts:

1. **Three-pane model is fixed** — do not collapse sidebar + right pane into a single-pane layout.
2. **Sidebar is always persistent on desktop** — do not hide it behind a toggle on lg+ screens.
3. **Right pane is embedded in pages** — not in `AppShell`. The shell stays thin.
4. **Right pane is hidden on mobile** — hidden, not removed. Content accessible via tabs.
5. **TreeSidebar is the primary nav surface** — do not replace it with a flat list.
6. **Autosave must not weaken versioning** — every autosave calls the same RPC as manual save.
7. **Document mode is the default** — notes open in rendered view, not raw textarea.
8. **Source mode shows exact stored markdown** — no transformation; labeled for AI.
9. **Semantic links are context relationships** — not backlinks or generic navigation.
10. **Graph views are read-only** — no editing in graph views.
11. **AppShell remains thin** — sidebar only; right panels live in page components.
12. **Sidebar items use small text and tight spacing** — keep the tree compact.
