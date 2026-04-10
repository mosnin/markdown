"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileText,
  Folder,
  Package,
  Share2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  type BoxOverview,
  type OverviewEdge,
  type OverviewNode,
} from "@/server/services/overview_service";

// ─── Relationship labels ──────────────────────────────────────────────────────

const REL_LABEL: Record<string, string> = {
  related: "Related to",
  depends_on: "Depends on",
  parent_of: "Parent of",
  child_of: "Child of",
  reference_for: "Reference for",
  extends: "Extends",
  example_of: "Example of",
  sibling_of: "Sibling of",
  supersedes: "Supersedes",
  derived_from: "Derived from",
};

function relLabel(type: string): string {
  return REL_LABEL[type] ?? type.replace(/_/g, " ");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns all node IDs in the subtree rooted at folderId, inclusive.
 * Used for folder-scope filtering.
 */
function subtreeIds(nodes: OverviewNode[], folderId: string): Set<string> {
  const childMap = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) {
      const arr = childMap.get(n.parentId) ?? [];
      arr.push(n.id);
      childMap.set(n.parentId, arr);
    }
  }
  const result = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.add(id);
    for (const child of childMap.get(id) ?? []) {
      queue.push(child);
    }
  }
  return result;
}

function noteIcon(noteKind: string | undefined) {
  if (noteKind === "guide") return BookOpen;
  if (noteKind === "bundle") return Package;
  return FileText;
}

// ─── Note chip ────────────────────────────────────────────────────────────────

function NoteChip({
  node,
  isGuide,
  isSelected,
  isConnected,
  linkCount,
  onClick,
}: {
  node: OverviewNode;
  isGuide: boolean;
  isSelected: boolean;
  isConnected: boolean;
  linkCount: number;
  onClick: () => void;
}) {
  const Icon = noteIcon(node.noteKind);
  return (
    <button
      type="button"
      role="treeitem"
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`${isGuide ? "Guide note: " : ""}${node.label}`}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-ring bg-accent font-medium text-foreground shadow-sm"
          : isConnected
          ? "border-ring/50 bg-accent/40 text-foreground"
          : isGuide
          ? "border-amber-300/70 bg-amber-50/60 text-foreground dark:border-amber-600/40 dark:bg-amber-900/20"
          : "border-border bg-card text-foreground/80 hover:border-ring/30 hover:bg-accent/30 hover:text-foreground"
      )}
    >
      {/* noteIcon() returns a stable module-level icon reference — not a new component */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          isGuide
            ? "text-amber-600 dark:text-amber-500"
            : "text-muted-foreground"
        )}
        aria-hidden="true"
      />
      <span className="max-w-[160px] truncate">{node.label}</span>
      {isGuide && (
        <span className="ml-0.5 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
          guide
        </span>
      )}
      {linkCount > 0 && !isSelected && !isConnected && (
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
          {linkCount}
        </span>
      )}
    </button>
  );
}

// ─── Folder tree (recursive) ──────────────────────────────────────────────────

function FolderTree({
  folder,
  depth,
  childFolderMap,
  childNoteMap,
  guideNoteId,
  selectedNodeId,
  connectedNoteIds,
  noteLinkCounts,
  onSelectNode,
}: {
  folder: OverviewNode;
  depth: number;
  childFolderMap: Map<string, OverviewNode[]>;
  childNoteMap: Map<string | null, OverviewNode[]>;
  guideNoteId: string | null;
  selectedNodeId: string | null;
  connectedNoteIds: Set<string>;
  noteLinkCounts: Map<string, number>;
  onSelectNode: (id: string) => void;
}) {
  const notes = childNoteMap.get(folder.id) ?? [];
  const subFolders = childFolderMap.get(folder.id) ?? [];
  const isEmpty = notes.length === 0 && subFolders.length === 0;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/20 p-3",
        depth > 0 && "border-border/60"
      )}
    >
      {/* Folder header — selectable */}
      <button
        type="button"
        role="treeitem"
        onClick={() => onSelectNode(folder.id)}
        aria-pressed={selectedNodeId === folder.id}
        aria-label={`Folder: ${folder.label}`}
        aria-expanded={!isEmpty}
        className={cn(
          "mb-2 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium transition-fast",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selectedNodeId === folder.id
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        )}
      >
        <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{folder.label}</span>
      </button>

      {/* Notes inside this folder */}
      {notes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Notes in ${folder.label}`}>
          {notes.map((note) => (
            <NoteChip
              key={note.id}
              node={note}
              isGuide={note.id === guideNoteId}
              isSelected={note.id === selectedNodeId}
              isConnected={connectedNoteIds.has(note.id)}
              linkCount={noteLinkCounts.get(note.id) ?? 0}
              onClick={() => onSelectNode(note.id)}
            />
          ))}
        </div>
      )}

      {isEmpty && (
        <p className="pl-1 text-[11px] italic text-muted-foreground/50">
          Empty folder
        </p>
      )}

      {/* Nested sub-folders */}
      {subFolders.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {subFolders.map((sub) => (
            <FolderTree
              key={sub.id}
              folder={sub}
              depth={depth + 1}
              childFolderMap={childFolderMap}
              childNoteMap={childNoteMap}
              guideNoteId={guideNoteId}
              selectedNodeId={selectedNodeId}
              connectedNoteIds={connectedNoteIds}
              noteLinkCounts={noteLinkCounts}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Node detail panel ────────────────────────────────────────────────────────

function NodeDetail({
  node,
  isGuide,
  outgoing,
  incoming,
  nodeMap,
  scopedIds,
}: {
  node: OverviewNode;
  isGuide: boolean;
  outgoing: OverviewEdge[];
  incoming: OverviewEdge[];
  nodeMap: Map<string, OverviewNode>;
  scopedIds: Set<string> | null;
}) {
  const Icon = node.kind === "folder" ? Folder : noteIcon(node.noteKind);
  const hasLinks = outgoing.length > 0 || incoming.length > 0;

  return (
    <div
      className="rounded-lg border border-ring/40 bg-card px-4 py-3"
      aria-label="Selected node details"
      aria-live="polite"
    >
      {/* Node identity */}
      <div className="flex items-start gap-2 mb-3">
        {/* noteIcon() returns a stable module-level icon reference — not a new component */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            isGuide
              ? "text-amber-600 dark:text-amber-500"
              : "text-muted-foreground"
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {node.kind === "note" ? (
              <Link
                href={`/app/notes/${node.id}`}
                className="text-sm font-medium text-foreground hover:underline underline-offset-2 transition-fast"
              >
                {node.label}
              </Link>
            ) : (
              <span className="text-sm font-medium text-foreground">
                {node.label}
              </span>
            )}
            {isGuide && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 text-[10px] font-normal"
              >
                <BookOpen className="h-3 w-3" aria-hidden="true" />
                Guide note
              </Badge>
            )}
            {node.noteKind && node.noteKind !== "note" && !isGuide && (
              <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                {node.noteKind}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
            {node.path}
          </p>
        </div>
        {node.kind === "note" && (
          <Link
            href={`/app/notes/${node.id}`}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-fast"
            aria-label={`Open note: ${node.label}`}
          >
            Open →
          </Link>
        )}
      </div>

      {/* Semantic connections */}
      {hasLinks ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          {outgoing.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                This note →
              </p>
              <div className="flex flex-col gap-1">
                {outgoing.map((edge) => {
                  const target = nodeMap.get(edge.targetNoteId);
                  const isExt = scopedIds && !scopedIds.has(edge.targetNoteId);
                  return (
                    <EdgeDetail
                      key={edge.id}
                      edge={edge}
                      counterpartId={edge.targetNoteId}
                      counterpartLabel={target?.label ?? "Note"}
                      direction="outgoing"
                      isExternal={!!isExt}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {incoming.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                → Referred by
              </p>
              <div className="flex flex-col gap-1">
                {incoming.map((edge) => {
                  const source = nodeMap.get(edge.sourceNoteId);
                  const isExt = scopedIds && !scopedIds.has(edge.sourceNoteId);
                  return (
                    <EdgeDetail
                      key={edge.id}
                      edge={edge}
                      counterpartId={edge.sourceNoteId}
                      counterpartLabel={source?.label ?? "Note"}
                      direction="incoming"
                      isExternal={!!isExt}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        node.kind === "note" && (
          <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground/60">
            No semantic relationships in this view.
          </p>
        )
      )}
    </div>
  );
}

// ─── Edge detail (inside node detail panel) ───────────────────────────────────

function EdgeDetail({
  edge,
  counterpartId,
  counterpartLabel,
  direction,
  isExternal,
}: {
  edge: OverviewEdge;
  counterpartId: string;
  counterpartLabel: string;
  direction: "outgoing" | "incoming";
  isExternal: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge
          variant="secondary"
          className="text-[10px] font-normal capitalize"
        >
          {relLabel(edge.relationshipType)}
        </Badge>
        <Link
          href={`/app/notes/${counterpartId}`}
          className="text-foreground/80 hover:text-foreground hover:underline underline-offset-2 transition-fast"
        >
          {counterpartLabel}
        </Link>
        {isExternal && (
          <span className="text-[10px] text-muted-foreground/60">
            [outside scope]
          </span>
        )}
      </div>
      {edge.relationshipNote && (
        <p className="text-muted-foreground italic">{edge.relationshipNote}</p>
      )}
    </div>
  );
}

// ─── Edge row (in edge list) ──────────────────────────────────────────────────

function EdgeRow({
  edge,
  nodeMap,
  isHighlighted,
  isExternal,
  onSelectSource,
  onSelectTarget,
}: {
  edge: OverviewEdge;
  nodeMap: Map<string, OverviewNode>;
  isHighlighted: boolean;
  isExternal: boolean;
  onSelectSource: () => void;
  onSelectTarget: () => void;
}) {
  const sourceLabel = nodeMap.get(edge.sourceNoteId)?.label ?? "Note";
  const targetLabel = nodeMap.get(edge.targetNoteId)?.label ?? "Note";

  return (
    <div
      role="listitem"
      className={cn(
        "flex flex-col gap-1 rounded-md border px-3 py-2 text-xs transition-fast",
        isHighlighted
          ? "border-ring/50 bg-accent/20"
          : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onSelectSource}
          className="min-w-0 truncate text-foreground/80 hover:text-foreground hover:underline underline-offset-2 transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {sourceLabel}
        </button>

        <div className="flex shrink-0 items-center gap-1 text-muted-foreground/60">
          <span className="h-px w-4 bg-current" aria-hidden="true" />
          <Badge
            variant="secondary"
            className="text-[10px] font-normal capitalize"
          >
            {relLabel(edge.relationshipType)}
          </Badge>
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </div>

        <button
          type="button"
          onClick={onSelectTarget}
          className="min-w-0 truncate text-foreground/80 hover:text-foreground hover:underline underline-offset-2 transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {targetLabel}
        </button>

        {isExternal && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
            cross-scope
          </span>
        )}
      </div>

      {edge.relationshipNote && (
        <p className="pl-0.5 italic text-muted-foreground">
          {edge.relationshipNote}
        </p>
      )}
    </div>
  );
}

// ─── Filter toggle ────────────────────────────────────────────────────────────

function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-fast select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-border accent-foreground"
      />
      {label}
    </label>
  );
}

// ─── Legend item ──────────────────────────────────────────────────────────────

function LegendItem({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
      {children}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BoxGraphViewProps {
  overview: BoxOverview;
}

/**
 * BoxGraphView — interactive read-only graph visualization for a box.
 *
 * Data sources (both from BoxOverview):
 *   - Hierarchy: parent-child folder/note containment (spatial grouping in the canvas)
 *   - Semantic links: explicit note-to-note context relationships (edge rows + node highlighting)
 *
 * Hierarchy is shown as folder group containers with note chips inside.
 * Semantic links are shown in the edge list and highlighted on node selection.
 * The two edge types are visually distinct: spatial containment vs. directed relationship rows.
 *
 * Guide note is highlighted with amber styling throughout.
 * Archived content is excluded (by BoxOverview — listNotesByBox only returns active).
 * Trashed content is excluded (by BoxOverview — same reason).
 */
export function BoxGraphView({ overview }: BoxGraphViewProps) {
  const { nodes, edges, truncated, box } = overview;
  const guideNoteId = box.guide_note_id;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [scopeFolderId, setScopeFolderId] = useState<string | null>(null);

  // Node lookup map
  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  // Scoped node IDs (null = all)
  const scopedIds = useMemo(
    () => (scopeFolderId ? subtreeIds(nodes, scopeFolderId) : null),
    [nodes, scopeFolderId]
  );

  // Visible nodes after scope filter
  const visibleNodes = useMemo(
    () => (scopedIds ? nodes.filter((n) => scopedIds.has(n.id)) : nodes),
    [nodes, scopedIds]
  );

  // Visible edges: in scope + cross-scope edges touching scoped notes
  const visibleEdges = useMemo(() => {
    if (!scopedIds) return edges;
    return edges.filter(
      (e) => scopedIds.has(e.sourceNoteId) || scopedIds.has(e.targetNoteId)
    );
  }, [edges, scopedIds]);

  // Per-note link count (for chip badges)
  const noteLinkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of visibleEdges) {
      counts.set(edge.sourceNoteId, (counts.get(edge.sourceNoteId) ?? 0) + 1);
      counts.set(edge.targetNoteId, (counts.get(edge.targetNoteId) ?? 0) + 1);
    }
    return counts;
  }, [visibleEdges]);

  // Notes semantically connected to selected node (for chip highlighting)
  const connectedNoteIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    return new Set<string>([
      ...visibleEdges
        .filter((e) => e.sourceNoteId === selectedNodeId)
        .map((e) => e.targetNoteId),
      ...visibleEdges
        .filter((e) => e.targetNoteId === selectedNodeId)
        .map((e) => e.sourceNoteId),
    ]);
  }, [selectedNodeId, visibleEdges]);

  // Edges touching selected node
  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return { outgoing: [] as OverviewEdge[], incoming: [] as OverviewEdge[] };
    return {
      outgoing: visibleEdges.filter((e) => e.sourceNoteId === selectedNodeId),
      incoming: visibleEdges.filter((e) => e.targetNoteId === selectedNodeId),
    };
  }, [selectedNodeId, visibleEdges]);

  // Build hierarchy maps for rendering
  const { rootFolders, rootNotes, childFolderMap, childNoteMap } =
    useMemo(() => {
      const folderNodes = visibleNodes.filter((n) => n.kind === "folder");
      const noteNodes = visibleNodes.filter((n) => n.kind === "note");

      const childFolderMap = new Map<string, OverviewNode[]>();
      const childNoteMap = new Map<string | null, OverviewNode[]>();

      for (const f of folderNodes) {
        // Only make it a child if its parent is visible in this scope
        if (f.parentId && nodeMap.has(f.parentId) && (!scopedIds || scopedIds.has(f.parentId))) {
          const arr = childFolderMap.get(f.parentId) ?? [];
          arr.push(f);
          childFolderMap.set(f.parentId, arr);
        }
      }

      for (const n of noteNodes) {
        const key =
          n.parentId && nodeMap.has(n.parentId) && (!scopedIds || scopedIds.has(n.parentId))
            ? n.parentId
            : null;
        const arr = childNoteMap.get(key) ?? [];
        arr.push(n);
        childNoteMap.set(key, arr);
      }

      // Root folders: visible folders whose parent is not a visible folder
      const rootFolders = folderNodes.filter(
        (f) =>
          !f.parentId ||
          !nodeMap.has(f.parentId) ||
          (scopedIds && !scopedIds.has(f.parentId))
      );

      const rootNotes = childNoteMap.get(null) ?? [];
      return { rootFolders, rootNotes, childFolderMap, childNoteMap };
    }, [visibleNodes, nodeMap, scopedIds]);

  // Folder options for scope dropdown (all folders, not scoped)
  const folderOptions = nodes.filter((n) => n.kind === "folder");

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

  function handleSelectNode(id: string) {
    setSelectedNodeId((prev) => (prev === id ? null : id));
  }

  const isEmpty = visibleNodes.length === 0;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Controls ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Visibility toggles */}
        <div className="flex items-center gap-3">
          <FilterToggle
            label="Hierarchy"
            checked={showHierarchy}
            onChange={setShowHierarchy}
          />
          <FilterToggle
            label="Relationships"
            checked={showLinks}
            onChange={setShowLinks}
          />
        </div>

        {/* Folder scope selector */}
        {folderOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Scope:</span>
            <select
              value={scopeFolderId ?? ""}
              onChange={(e) => {
                setScopeFolderId(e.target.value || null);
                setSelectedNodeId(null);
              }}
              aria-label="Scope graph to folder subtree"
              className={cn(
                "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring"
              )}
            >
              <option value="">All</option>
              {folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Clear selection */}
        {selectedNodeId && (
          <button
            type="button"
            onClick={() => setSelectedNodeId(null)}
            aria-label="Clear node selection"
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Clear selection
          </button>
        )}
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
        aria-label="Graph legend"
      >
        <LegendItem>
          <span className="inline-block h-3 w-3 rounded-sm border border-border bg-card" />
          Note
        </LegendItem>
        <LegendItem>
          <span className="inline-block h-3 w-3 rounded-sm border border-amber-300/70 bg-amber-50/60 dark:border-amber-600/40 dark:bg-amber-900/20" />
          Guide note
        </LegendItem>
        <LegendItem>
          <span className="inline-block h-3 w-3 rounded-sm border border-ring bg-accent" />
          Selected
        </LegendItem>
        <LegendItem>
          <span className="inline-block h-3 w-3 rounded-sm border border-border bg-muted/20" />
          Folder (hierarchy)
        </LegendItem>
        <LegendItem>
          <span className="inline-flex items-center gap-0.5 text-muted-foreground/60">
            <span className="h-px w-3 bg-current" aria-hidden="true" />
            <ChevronRight className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
          Semantic link
        </LegendItem>
      </div>

      {/* ── Hierarchy canvas ─────────────────────────────────────────────────── */}
      {showHierarchy && !isEmpty && (
        <section aria-labelledby="graph-hierarchy-heading">
          <h3
            id="graph-hierarchy-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Structure
          </h3>

          <div className="flex flex-col gap-2 overflow-x-auto" role="tree" aria-label="Box structure">
            {/* Root-level notes (not in any folder) */}
            {rootNotes.length > 0 && (
              <div className="rounded-lg border border-dashed border-border/60 p-3">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Root notes
                </p>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Notes at root level"
                >
                  {rootNotes.map((note) => (
                    <NoteChip
                      key={note.id}
                      node={note}
                      isGuide={note.id === guideNoteId}
                      isSelected={note.id === selectedNodeId}
                      isConnected={connectedNoteIds.has(note.id)}
                      linkCount={noteLinkCounts.get(note.id) ?? 0}
                      onClick={() => handleSelectNode(note.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Folder groups */}
            {rootFolders.map((folder) => (
              <FolderTree
                key={folder.id}
                folder={folder}
                depth={0}
                childFolderMap={childFolderMap}
                childNoteMap={childNoteMap}
                guideNoteId={guideNoteId}
                selectedNodeId={selectedNodeId}
                connectedNoteIds={connectedNoteIds}
                noteLinkCounts={noteLinkCounts}
                onSelectNode={handleSelectNode}
              />
            ))}

            {/* Empty hierarchy */}
            {rootNotes.length === 0 && rootFolders.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No content in this view.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Selected node detail ─────────────────────────────────────────────── */}
      {selectedNode && (
        <NodeDetail
          node={selectedNode}
          isGuide={selectedNode.id === guideNoteId}
          outgoing={selectedEdges.outgoing}
          incoming={selectedEdges.incoming}
          nodeMap={nodeMap}
          scopedIds={scopedIds}
        />
      )}

      {/* ── Context relationships ────────────────────────────────────────────── */}
      {showLinks && visibleEdges.length > 0 && (
        <section aria-labelledby="graph-links-heading">
          <h3
            id="graph-links-heading"
            className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            Context relationships
            <span className="font-normal text-muted-foreground/60">
              ({visibleEdges.length})
            </span>
          </h3>
          <div className="flex flex-col gap-1.5" role="list" aria-label="Semantic note relationships">
            {visibleEdges.map((edge) => {
              const isExt =
                scopedIds !== null &&
                (!scopedIds.has(edge.sourceNoteId) ||
                  !scopedIds.has(edge.targetNoteId));
              const isHighlighted =
                selectedNodeId === edge.sourceNoteId ||
                selectedNodeId === edge.targetNoteId;
              return (
                <EdgeRow
                  key={edge.id}
                  edge={edge}
                  nodeMap={nodeMap}
                  isHighlighted={isHighlighted}
                  isExternal={isExt}
                  onSelectSource={() => handleSelectNode(edge.sourceNoteId)}
                  onSelectTarget={() => handleSelectNode(edge.targetNoteId)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* No relationships */}
      {showLinks && visibleEdges.length === 0 && !isEmpty && (
        <p className="text-xs text-muted-foreground/60">
          No semantic relationships in this view.
        </p>
      )}

      {/* Empty box */}
      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          {scopeFolderId ? "No content in this folder scope." : "No content yet."}
        </p>
      )}
    </div>
  );
}
