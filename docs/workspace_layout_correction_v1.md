# Workspace layout correction — V1

This document describes the three-pane workspace model, sidebar tree behavior,
note editor model, graph view role, and semantic link conventions implemented in
the workspace layout correction pass.

Later prompts must preserve all rules described here.

---

## Three-pane workspace model

The app uses a three-pane layout on desktop (md+):

```
[left sidebar 240px] | [center pane flex-1] | [right context pane 288px]
```

**Left sidebar** — persistent on desktop, sheet drawer on mobile.
Handled by `AppShell`, `AppSidebar`, and `MobileSidebar`.

**Center pane** — the primary working surface. Contains:
- The note editor (on note pages)
- The box content view (on box pages)
- The workspace cockpit (on the home page)

**Right context pane** — visible on note and box pages at lg+ breakpoint.
Embedded directly in page components (not in the shell), keeping the shell thin.
Contains: note metadata, semantic links, version info, context bundle, history (note);
guide note picker, content stats, folder policies (box).

### Mobile

On mobile (< md), the left sidebar is replaced by a top bar with a hamburger button
that opens a full-height sheet (`MobileSidebar`). The right pane is hidden on mobile —
its content is accessible via the right-panel tabs in the note page.

---

## Left sidebar tree

### Structure

The sidebar shows boxes as expandable tree entries. The tree is the primary
navigation surface — not a secondary "Tree" tab view.

```
Context Store
─────────────────────────
Home
Workspace
Proposals
Audit log
─────────────────────────
[workspace name]            +
  ▶ Box A                   (collapsed)
  ▼ Box B                   (expanded, active)
    ├─ Folder 1
    │   ├─ 📝 Note A        (active — highlighted)
    │   └─ 📝 Note B
    ├─ Folder 2
    │   └─ 📖 Guide note
    └─ 📝 Root note
─────────────────────────
Settings
[user menu]
```

### Behavior

**Expand/collapse** — clicking the chevron (▶/▼) expands or collapses a box entry.
Clicking the box name navigates to `/app/boxes/[id]`.

**Lazy loading** — tree data (folders + notes) is fetched from a server action
(`getBoxTreeAction`) the first time a box is expanded. The data is cached in
component state for the session. This keeps the layout fast while supporting
unlimited nesting.

**Auto-expand** — when the current URL is `/app/boxes/[id]` or `/app/notes/[id]`,
the relevant box auto-expands on mount if not already expanded.

**Active highlighting** — the current note entry gets `bg-sidebar-accent` styling.
The active box entry is also highlighted as "current".

**Icons** — notes use different icons by `kind`:
- `note` → FileText
- `guide` → BookOpen
- `bundle` → Package

**Empty state** — when a box has no folders or notes, the tree shows "No content yet."
When no boxes exist, a link to create the first box is shown.

### Implementation

- `TreeSidebar` (client component) — receives `boxes`, `currentBoxId`, `currentNoteId`
- `AppSidebar` extracts `currentBoxId` and `currentNoteId` from pathname using regex
- `getBoxTreeAction` (server action in `src/app/app/boxes/actions.ts`) — fetches
  folders and notes for a box after verifying workspace ownership
- `buildBoxTree` (from `box_contents_tree.tsx`) — builds the nested tree from flat lists

---

## Note page layout

### Center pane — three modes

The note editor exposes three clearly labeled modes via a toolbar toggle:

| Mode | Icon | Label | Description |
|---|---|---|---|
| Document | Eye | Document | Rendered markdown — the primary reading experience for humans |
| Edit | Pencil | Edit | Markdown textarea — the primary writing surface, with autosave |
| Source | Code2 | Markdown | Raw markdown, read-only — "what the AI model receives" |

**Document mode** (default when opening a note) — renders the markdown as a styled
prose document using `renderMarkdown`. Clicking anywhere in the document area or on
the title field switches to Edit mode. This is the human reading view.

**Edit mode** — a full-height markdown textarea with monospace font, autosave, and
an expandable metadata section (summary, tags, read hint). The canonical editing surface.

**Source mode** — read-only preformatted view of the raw markdown string. Labeled
explicitly as "what the AI model receives — unmodified source". Used to verify that
the note's AI-facing representation is what you intended.

No proprietary rich text conversion is performed. The markdown stored in the database
is exactly what appears in Source mode.

### Autosave behavior

Autosave fires automatically 1.5 seconds after the last content change (title, body,
summary, tags, or read hint). The mechanism:

1. `useEffect` watches all content fields.
2. On any change, a `setTimeout` of `AUTOSAVE_DEBOUNCE_MS = 1500` is set.
3. If content changes again before the timer fires, the timer is reset.
4. On timeout: `saveNoteAction` is called (same path as the old manual save).
5. Every save creates a new immutable version via `update_note_and_create_version` RPC.

**Save state** — a subtle `AutosaveStatus` component in the toolbar shows:
- Nothing (idle, no changes)
- "Saving…" with a spinner (during save)
- "Saved just now" / "Saved 2m ago" with a check (after save, fades to idle)
- Error message with a Retry button (if save fails)

**Trust guarantee** — autosave does not weaken the versioning or optimistic locking
model. Every save call is identical to a manual save; the version history grows normally.

### Right context pane — tabs

The right pane on the note page uses four tabs:

| Tab | Contents |
|---|---|
| Info | Kind, guide status, tags, location, version ID, last updated, summary, read hint |
| Links | Semantic context relationships (see below) |
| Bundle | Context bundle viewer (existing `ContextBundleViewer`) |
| History | Version history (existing `NoteHistoryPanel`) |

---

## Graph views

### Role

Graph views are **secondary** to the tree. They exist to help humans understand
structure and explicit note relationships spatially. They are read-only. They do
not support editing.

### Box graph

Accessible via the "Graph" tab on the box page. Uses the `GraphPanel` component,
which renders:
1. Summary stats: folder count, note count, link count
2. Truncation warning (if box exceeds the 1000-node / 2000-edge limit)
3. Hierarchy: the folder/note tree, mirroring the structure from the tree view
4. Context relationships: explicit note links shown as source → type → target rows

The graph data comes from `getBoxOverview` → `BoxOverview`, which includes all
nodes and edges from the existing overview service. No new data fetching.

The box page renamed the "Overview" tab to "Graph" to set clearer expectations
about what this view shows.

### No advanced graph UI

There is no force-directed layout, D3, or other graph library. The graph view uses
structured HTML/CSS to represent the hierarchy and link edges clearly. This matches
the constraint: "do not build advanced graph visualization."

---

## Explicit semantic links vs backlinks

Note links in Context Store are **explicit semantic context relationships** — not a
backlink system. They are created intentionally by the human to describe HOW one note
relates to another. They are included automatically in context bundles and help AI
models understand the note's position in the knowledge graph.

### Correct framing

- Section title: "Context relationships" (not "Linked notes" or "Backlinks")
- Outgoing header: "This note →" (what this note points to)
- Incoming header: "→ Referred by" (what points to this note)
- Empty state: explains AI context bundle use, not navigation
- Relationship type shown as a semantic label ("Related to", "Depends on", etc.)
- `relationship_note` shown as an annotation explaining the relationship

### What links are NOT

- Not generic backlinks (the system does not auto-generate them from text mentions)
- Not navigation shortcuts (they are metadata, not primary navigation)
- Not bidirectional by default (outgoing and incoming are shown separately)

### Implementation

`SemanticLinksPanel` (client component) replaces the `LinkedNotesSection` in the
right context pane of the note page. It uses the same underlying data and actions
(`deleteLinkAction`, `CreateLinkDialog`) but with corrected framing language.

---

## Box page structure

### Above the fold

The box page header always shows:
- Workspace name (breadcrumb-style eyebrow)
- Box name (h1)
- Box description (if set)
- Guide note status: either the guide note title (linked) or a "no guide" message
- Action bar: import, export, lifecycle, create folder, create note

### Tabs

| Tab | Purpose |
|---|---|
| Notes | Sorted list of active notes (most recent first) |
| Tree | Full folder/note hierarchy with lifecycle menus |
| Guide | Structured box interpretation (guide note, top notes, tags) |
| Graph | Read-only hierarchy + link edge visualization |
| Search | Full-text note search |
| Archived | Archived notes and folders (shown only if any exist) |
| Trash | Trashed notes and folders (shown only if any exist) |

The "Overview" tab was renamed to "Graph" to accurately describe the view's role.

---

## Workspace home (cockpit)

The workspace home (`/app`) is structured as a cockpit with:

1. **Workspace header** — name, "Create box" action
2. **Status row** — four tiles: boxes, recent notes, active connections, pending proposals
3. **Recent notes** — up to 10 most-recently-updated notes across all boxes
4. **Boxes** — card grid linking to each box, with description and guide status indicator
5. **Active connections** — summary of connections with access to the workspace
6. **Pending proposals** — callout when AI write proposals need review

Status tiles are functional (linked to relevant pages where appropriate), not vanity
metrics. The cockpit should feel like a useful overview, not a dashboard with charts.

---

## Component inventory

### New components

| Component | Type | Purpose |
|---|---|---|
| `AutosaveStatus` | client | Subtle autosave state indicator (idle/saving/saved/error) |
| `SemanticLinksPanel` | client | Context relationships panel for note right pane |
| `DashboardSection` | server | Section wrapper for the workspace cockpit |
| `DashboardCard` | server | Card component for the cockpit |
| `TreeSidebar` | client | Expandable box tree for the sidebar |
| `GraphPanel` | server | Read-only graph for box structure + link edges |

### Modified components

| Component | Change |
|---|---|
| `AppSidebar` | Uses `TreeSidebar` instead of flat box list |
| `MobileSidebar` | Uses `TreeSidebar` for consistent tree navigation |
| `NoteEditor` | Autosave (1.5s debounce) + Document/Edit/Source mode toggle |

### Modified pages

| Page | Change |
|---|---|
| `app/page.tsx` | Cockpit home with status tiles, recent notes, boxes, connections, proposals |
| `boxes/[box_id]/page.tsx` | Box header with guide status; "Overview" tab → "Graph" using `GraphPanel` |
| `notes/[note_id]/page.tsx` | Three-pane with Info/Links/Bundle/History right pane; `SemanticLinksPanel` |

---

## Rules for future prompts

1. **Do not change the three-pane layout model** (sidebar + center + right).
2. **Do not flatten the sidebar tree** into a simple list.
3. **Do not remove the Document/Edit/Source mode toggle** from the note editor.
4. **Preserve autosave** — 1.5s debounce, same version creation path as manual save.
5. **Do not rename "Context relationships"** to "Linked notes" or "Backlinks".
6. **Graph views remain read-only** — no editing workflows in graph views.
7. **Markdown is always the stored source** — Source mode shows the exact stored string.
8. **Keep the sidebar compact** — tree items use small text and tight spacing.
9. **Right pane is hidden on mobile** — it is not removed, just hidden at < lg.
10. **AppShell remains thin** — right panels are embedded in page components, not the shell.
