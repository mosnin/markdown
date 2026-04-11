# Graph view — V1

This document specifies the read-only box graph view: its data model, visual language,
interaction model, filtering behavior, and the rules later prompts must preserve.

Later prompts must preserve all rules described here.

---

## Current scope status (April 2026)

- Graph now shows all object types:
  - folders
  - notes
  - files
  - skills
  - agents
- Edges include both note_links (note-to-note) and object_links (cross-type).
- Graph rendering uses **@xyflow/react** with **dagre** layout engine.
- Graph is interactive: pan, zoom, drag nodes, click to select.
- Graph remains **read-only** — no connection creation or editing.

---

## Purpose and role

Graph views are **secondary** to the tree. They exist so humans can spatially understand
structure and explicit relationships in a box. They are read-only. No editing happens
in a graph view.

The box graph is accessible via the "Graph" tab on the box page (`/app/boxes/[id]`).

---

## Data model

All graph data comes from `BoxOverview` (the overview service). No additional data
fetching is required.

### BoxOverview shape

```typescript
interface BoxOverview {
  box: Box;
  nodes: OverviewNode[];
  edges: OverviewEdge[];
  folderCount: number;
  noteCount: number;
  fileCount: number;
  skillCount: number;
  agentCount: number;
  edgeCount: number;
  truncated: boolean;         // true if box exceeds 1000 nodes / 2000 edges
}

type OverviewNodeKind = "folder" | "note" | "file" | "skill" | "agent";

interface OverviewNode {
  id: string;
  kind: OverviewNodeKind;
  label: string;
  path: string;
  noteKind?: string;           // note | guide | bundle (for notes only)
  parentFolderId: string | null;
  parentId: string | null;
  isReusable?: boolean;        // workspace-level reusable (skills/agents)
  isAttachment?: boolean;      // attached by reference
}

interface OverviewEdge {
  id: string;
  sourceNoteId: string;        // source object ID (named for backwards compat)
  targetNoteId: string;        // target object ID
  relationshipType: string;
  relationshipNote: string | null;
  edgeKind?: "note_link" | "object_link";
  sourceType?: string;         // object type of source
  targetType?: string;         // object type of target
}
```

The overview service excludes archived and trashed content from both nodes and edges.
The graph view inherits this exclusion — it does not show lifecycle-filtered content.

### Two distinct edge categories

The graph encodes two fundamentally different kinds of structure:

| Type | What it encodes | How it appears |
|---|---|---|
| **Hierarchy** | Parent-child folder containment (from `parentId`) | Smooth-step edges with subdued styling |
| **Semantic links** | Explicit relationships (from `edges`) — both note_links and object_links | Animated bezier edges with labels |

These are visually distinct through different edge types, colors, and animation.

---

## Component architecture

### GraphPanel (server component)

`src/components/product/graph_panel.tsx` — thin server wrapper.

Renders:
1. Summary stats row: folder count, note count, file count, skill count, agent count, link count
2. Truncation warning (if `truncated` is true)
3. `<BoxGraphView overview={overview} />` — the interactive client component

`GraphPanel` stays a server component so it can be composed directly on the box page
without making the whole page client-side.

### BoxGraphView (client component)

`src/components/product/box_graph_view.tsx` — all interactivity lives here.

Uses:
- **@xyflow/react** — ReactFlow for interactive node-edge graph rendering
- **@dagrejs/dagre** — automatic hierarchical layout engine

The component is wrapped in `ReactFlowProvider` for hook access.

State:
- `scopeFolderId: string | null` — constrain view to a folder subtree (default null = all)
- `selectedNodeId: string | null` — the currently focused node

Layout:
- Dagre runs automatically when data or scope changes
- `rankdir: "TB"` (top-to-bottom) layout
- Node separation: 40px, rank separation: 60px
- Nodes are draggable for manual adjustment after layout

---

## Visual language

### Node types

All nodes use a single custom ReactFlow node type (`graphNode`). Visual differentiation
is through icons and coloring:

| Object type | Icon | Color accent |
|---|---|---|
| Folder | Folder | Neutral (muted) |
| Note | FileText | Neutral |
| Note (guide) | BookOpen | Amber |
| Note (bundle) | Package | Neutral |
| File | File | Green |
| Skill | Zap | Yellow |
| Agent | Bot | Blue |

### Node states

| State | Visual |
|---|---|
| Normal | `border-border bg-card` |
| Guide note | `border-amber-300/70 bg-amber-50/60` + amber icon |
| Selected | `border-violet-400/80 bg-violet-50` |
| Folder | `border-border bg-muted/30` |
| Reusable | Shows `↗` indicator |

### Edge types

| Category | Style | Description |
|---|---|---|
| Hierarchy | Smooth-step, subdued, non-animated | Parent-child containment |
| Note link | Bezier, violet, animated | Note-to-note semantic relationship |
| Object link | Bezier, info color, animated | Cross-type semantic relationship |

Edges include relationship type labels positioned on the edge path.

### Legend

A compact legend appears in the controls bar showing icon + label for each object type.

---

## Interaction model

### Node selection

Clicking a node **selects** it. Clicking an already-selected node **deselects** it (toggle).
Only one node is selected at a time.

When a node is selected, a **detail panel** appears below the graph canvas showing:
- Node identity: icon, label, type badge, guide badge (if applicable), path
- "Open →" link to navigate to the object
- Outgoing semantic links: "Outgoing →" section
- Incoming semantic links: "→ Incoming" section

### Navigation

Clicking the link text inside a node navigates to that object's page.
Clicking "Open →" in the detail panel also navigates.

### Folder scope

A `<select>` in the controls bar constrains the view to a folder subtree.
Options: "All" (null scope) + one option per folder.

When a scope folder is selected:
- Only nodes in the subtree (inclusive) are shown.
- Edges where at least one endpoint is in scope are shown.
- Selecting a new scope clears the node selection and triggers re-layout.

### Graph controls

ReactFlow provides built-in controls:
- Pan (drag background)
- Zoom (scroll wheel, pinch, or control buttons)
- Fit view (control button)
- Node dragging for manual arrangement

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

## Truncation

If `BoxOverview.truncated` is true, a warning banner appears in `GraphPanel` before
the interactive graph:

> "This box exceeds the display limit (1 000 nodes / 2 000 edges). Only the first
> portion is shown."

The graph still renders with the data it has. Truncation is applied by the
overview service; `BoxGraphView` does not apply additional limits.

---

## Rules for future prompts

1. **Graph views are read-only** — no editing, creating, or deleting nodes/edges in graph views.
2. **@xyflow/react is the graph library** — do not switch to D3, Cytoscape, or vis.js.
3. **dagre is the layout engine** — provides automatic hierarchical layout.
4. **Guide note must always be identifiable** — the amber styling must be preserved.
5. **Hierarchy and semantic edges must remain visually distinct** — hierarchy is subdued smooth-step; semantic links are animated bezier with labels.
6. **Stats and truncation warning stay in GraphPanel** — not moved into BoxGraphView.
7. **BoxGraphView is the only interactive graph component** — do not add a second one.
8. **Cross-scope edges must be labeled** — never silently hide cross-scope edges.
9. **Node detail panel uses directional framing** — "Outgoing →" and "→ Incoming".
10. **BoxOverview is the only data source** — do not fetch additional data in graph components.
11. **All five object types must have nodes** — folders, notes, files, skills, agents.
12. **Both note_links and object_links are shown as edges** — cross-type relationships are first class.
