# Graph view — V1

This document specifies the read-only box graph view: its data model, visual language,
interaction model, filtering behavior, and the rules later prompts must preserve.

Later prompts must preserve all rules described here.

---

## Current scope status (April 2026)

- Implemented graph scope is still the BoxOverview model documented below:
  - folders
  - notes
  - note links
- Full cross-object graphing for files/skills/agents is **not yet implemented**.
- Any roadmap claim that the graph already includes files/skills/agents should be treated as incorrect until this doc is revised with concrete schema + rendering changes.

---

## Purpose and role

Graph views are **secondary** to the tree. They exist so humans can spatially understand
structure and explicit note relationships in a box. They are read-only. No editing happens
in a graph view.

The box graph is accessible via the "Graph" tab on the box page (`/app/boxes/[id]`).

---

## Data model

All graph data comes from `BoxOverview` (the overview service). No additional data
fetching is required.

### BoxOverview shape

```typescript
interface BoxOverview {
  box: Box;                   // box.guide_note_id identifies the guide note
  nodes: OverviewNode[];
  edges: OverviewEdge[];
  folderCount: number;
  noteCount: number;
  edgeCount: number;
  truncated: boolean;         // true if box exceeds 1000 nodes / 2000 edges
}

interface OverviewNode {
  id: string;
  kind: "folder" | "note";
  label: string;              // display name
  path: string;               // full path (shown in detail panel)
  noteKind?: "note" | "guide" | "bundle";
  parentId: string | null;    // parent folder ID, or null for root
}

interface OverviewEdge {
  id: string;
  sourceNoteId: string;
  targetNoteId: string;
  relationshipType: string;   // e.g. "related", "depends_on", "extends"
  relationshipNote?: string;  // optional annotation on the relationship
}
```

The overview service excludes archived and trashed content from both nodes and edges.
The graph view inherits this exclusion — it does not show lifecycle-filtered content.

### Two distinct edge types

The graph encodes two fundamentally different kinds of structure:

| Type | What it encodes | How it appears |
|---|---|---|
| **Hierarchy** | Parent-child folder/note containment (from `parentId`) | Spatial grouping — folders as containers |
| **Semantic links** | Explicit note-to-note context relationships (from `edges`) | Directed edge rows in the relationships section |

These are visually distinct. Containment is implicit in the spatial layout (a note inside
a folder group IS contained by that folder). Semantic links are explicit rows with
source → type → target layout.

---

## Component architecture

### GraphPanel (server component)

`src/components/product/graph_panel.tsx` — thin server wrapper.

Renders:
1. Summary stats row: folder count, note count, link count
2. Truncation warning (if `truncated` is true)
3. `<BoxGraphView overview={overview} />` — the interactive client component

`GraphPanel` stays a server component so it can be composed directly on the box page
without making the whole page client-side.

### BoxGraphView (client component)

`src/components/product/box_graph_view.tsx` — all interactivity lives here.

State:
- `selectedNodeId: string | null` — the currently focused node
- `showHierarchy: boolean` — toggle the hierarchy canvas (default true)
- `showLinks: boolean` — toggle the relationships section (default true)
- `scopeFolderId: string | null` — constrain view to a folder subtree (default null = all)

---

## Visual language

### Hierarchy canvas

Hierarchy is rendered as **folder group containers** with note chips inside:

```
┌─────────────────────────────────────┐
│  📁 Folder A                        │
│  ┌──────────┐  ┌──────────┐        │
│  │ 📝 Note  │  │ 📝 Note  │        │
│  └──────────┘  └──────────┘        │
│  ┌─────────────────────────────┐   │
│  │  📁 Sub-folder              │   │
│  │  ┌──────────┐               │   │
│  │  │ 📝 Note  │               │   │
│  │  └──────────┘               │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

Root-level notes (not in any folder) appear in a dashed-border "Root notes" group.

### Note chip states

| State | Visual |
|---|---|
| Normal | `border-border bg-card text-foreground/80` |
| Guide note | `border-amber-300/70 bg-amber-50/60` + amber icon + "guide" label |
| Selected | `border-ring bg-accent font-medium shadow-sm` |
| Connected | `border-ring/50 bg-accent/40` (connected to selected node via semantic link) |

The guide note is `box.guide_note_id`. It is highlighted with amber throughout —
in the hierarchy canvas, in the node detail panel, and in the legend.

### Folder header states

| State | Visual |
|---|---|
| Normal | `text-muted-foreground hover:bg-accent/40` |
| Selected | `bg-accent text-foreground` |

### Semantic link rows (edge list)

Each edge row shows: `source name → [relationship badge] → target name`.

| State | Visual |
|---|---|
| Normal | `border-border bg-card` |
| Highlighted | `border-ring/50 bg-accent/20` (source or target is selected node) |
| Cross-scope | "cross-scope" label in muted text (edge crosses folder scope boundary) |

### Legend

The legend is always visible above the hierarchy canvas. Items:
- Note (card chip)
- Guide note (amber chip)
- Selected (accent chip with ring)
- Folder hierarchy (muted container)
- Semantic link (horizontal line + arrow)

---

## Interaction model

### Node selection

Clicking a note chip or folder header **selects** that node. Selecting an already-selected
node **deselects** it (toggle). Only one node is selected at a time.

When a node is selected:
1. A **node detail panel** appears below the hierarchy canvas, showing:
   - Node identity: icon, label, guide badge (if applicable), path, "Open →" link (notes only)
   - Outgoing semantic links: "This note →" section with EdgeDetail rows
   - Incoming semantic links: "→ Referred by" section with EdgeDetail rows
   - Empty state: "No semantic relationships in this view."
2. All note chips **connected** to the selected node via semantic links gain `connected` styling.
3. Edge rows in the relationships section are **highlighted** if they touch the selected node.

Clicking "Clear selection" or clicking the selected node again deselects.

### Filter toggles

Two checkboxes in the controls bar:
- **Hierarchy** — show/hide the hierarchy canvas (default on)
- **Relationships** — show/hide the edge list (default on)

Both can be toggled independently. If hierarchy is hidden, the canvas section disappears.
If relationships is hidden, the edge list section disappears. Node selection and connected
highlighting still work when the canvas is visible.

### Folder scope

A `<select>` in the controls bar lets the user constrain the view to a folder subtree.
Options: "All" (null scope) + one option per folder.

When a scope folder is selected:
- Only nodes in the subtree (inclusive) are shown in the hierarchy canvas.
- Only edges where at least one endpoint is in scope are shown.
- Edges where one endpoint is outside scope are shown with "cross-scope" / "[outside scope]" labels.
- Selecting a new scope clears the node selection.

Scope uses BFS from the selected folder (`subtreeIds` helper).

---

## Relationship types

Semantic links use a fixed vocabulary. The display labels:

| `relationshipType` value | Display label |
|---|---|
| `related` | Related to |
| `depends_on` | Depends on |
| `parent_of` | Parent of |
| `child_of` | Child of |
| `reference_for` | Reference for |
| `extends` | Extends |
| `example_of` | Example of |
| `sibling_of` | Sibling of |
| `supersedes` | Supersedes |
| `derived_from` | Derived from |

Unknown types fall back to replacing underscores with spaces.

---

## Note icons by kind

| `noteKind` | Icon |
|---|---|
| `note` | FileText |
| `guide` | BookOpen |
| `bundle` | Package |

---

## Truncation

If `BoxOverview.truncated` is true, a warning banner appears in `GraphPanel` before
the interactive graph:

> "This box exceeds the display limit (1 000 nodes / 2 000 edges). Only the first
> portion is shown."

The graph still renders with the data it has. The truncation is applied by the
overview service; `BoxGraphView` does not apply additional limits.

---

## Rules for future prompts

1. **Graph views are read-only** — no editing, creating, or deleting nodes/edges in graph views.
2. **No external graph libraries** — no D3, no force-directed layout, no Cytoscape, no vis.js.
   Use structured HTML/CSS layout only.
3. **Do not replace folder containers with a node-edge diagram** — spatial containment IS
   the hierarchy representation. Do not draw folder→note edges as arrows.
4. **Guide note must always be identifiable** — the amber chip styling must be preserved.
5. **Hierarchy and semantic links must remain visually distinct** — containment is spatial;
   semantic links are explicit directed rows. They must not look the same.
6. **Stats and truncation warning stay in GraphPanel** — not moved into BoxGraphView.
7. **BoxGraphView is the only interactive graph component** — do not add a second one.
8. **scopedIds cross-scope edges must be labeled** — never silently hide cross-scope edges.
9. **Node detail panel uses semantic links framing** — "This note →" and "→ Referred by",
   consistent with `SemanticLinksPanel` in the note right pane.
10. **BoxOverview is the only data source** — do not fetch additional data in graph components.
