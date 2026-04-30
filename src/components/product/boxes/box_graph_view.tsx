"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import {
  BookOpen,
  Bot,
  File,
  FileText,
  Folder,
  Package,
  Search,
  Share2,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  type BoxOverview,
  type OverviewEdge,
} from "@/server/services/overview_service";

import "@xyflow/react/dist/style.css";

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

// Semantic edge colors per relationship type
const RELATIONSHIP_COLORS: Record<string, string> = {
  related:       "#8b5cf6", // violet
  depends_on:    "#ef4444", // red — dependency is critical
  parent_of:     "#3b82f6", // blue
  child_of:      "#60a5fa", // light blue
  reference_for: "#10b981", // emerald
  extends:       "#6366f1", // indigo
  example_of:    "#f59e0b", // amber
  sibling_of:    "#94a3b8", // slate
  supersedes:    "#f43f5e", // rose
  derived_from:  "#a78bfa", // purple
};

// ─── Node data types ──────────────────────────────────────────────────────────

type GraphNodeData = {
  label: string;
  nodeKind: string; // folder | note | file | skill | agent
  noteKind?: string; // note | guide | bundle
  objectId: string;
  isGuide: boolean;
  path: string;
  isReusable?: boolean;
  isAttachment?: boolean;
};

type GraphEdgeData = {
  relationshipType: string;
  relationshipNote?: string | null;
  edgeKind?: string;
  sourceType?: string;
  targetType?: string;
};

// ─── Dagre layout ─────────────────────────────────────────────────────────────

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;
const FOLDER_WIDTH = 200;
const FOLDER_HEIGHT = 52;

function applyDagreLayout(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
  direction: "TB" | "LR" = "TB"
): Node<GraphNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 60,
    marginx: 20,
    marginy: 20,
  });

  for (const node of nodes) {
    const isFolder = node.data?.nodeKind === "folder";
    g.setNode(node.id, {
      width: isFolder ? FOLDER_WIDTH : NODE_WIDTH,
      height: isFolder ? FOLDER_HEIGHT : NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const isFolder = node.data?.nodeKind === "folder";
    const w = isFolder ? FOLDER_WIDTH : NODE_WIDTH;
    const h = isFolder ? FOLDER_HEIGHT : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function getNodeIcon(nodeKind: string, noteKind?: string) {
  switch (nodeKind) {
    case "folder": return Folder;
    case "note":
      if (noteKind === "guide") return BookOpen;
      if (noteKind === "bundle") return Package;
      return FileText;
    case "file": return File;
    case "skill": return Zap;
    case "agent": return Bot;
    default: return FileText;
  }
}

function getNodeHref(nodeKind: string, objectId: string): string {
  switch (nodeKind) {
    case "folder": return `/app/folders/${objectId}`;
    case "note": return `/app/notes/${objectId}`;
    case "file": return `/app/files/${objectId}`;
    case "skill": return `/app/skills/${objectId}`;
    case "agent": return `/app/agents/${objectId}`;
    default: return "#";
  }
}

// ─── Custom node components ───────────────────────────────────────────────────

function GraphNode({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  const Icon = getNodeIcon(data.nodeKind, data.noteKind);
  const href = getNodeHref(data.nodeKind, data.objectId);
  const isFolder = data.nodeKind === "folder";
  const isGuide = data.isGuide;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 shadow-xs transition-fast",
        "min-w-[140px] max-w-[200px]",
        isFolder
          ? selected
            ? "border-brand-400/80 bg-brand-50 dark:border-brand-500/60 dark:bg-brand-950/60"
            : "border-border bg-muted/30 dark:bg-muted/20"
          : isGuide
          ? selected
            ? "border-brand-400/80 bg-brand-50 dark:border-brand-500/60 dark:bg-brand-950/60"
            : "border-amber-300/70 bg-amber-50/60 dark:border-amber-600/40 dark:bg-amber-900/20"
          : selected
          ? "border-brand-400/80 bg-brand-50 dark:border-brand-500/60 dark:bg-brand-950/60"
          : "border-border bg-card hover:border-border-strong hover:shadow-sm"
      )}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-muted-foreground/30 !border-none" />

      <Link
        href={href}
        className="flex items-center gap-2 text-xs no-underline"
        onClick={(e) => e.stopPropagation()}
      >
        {/* getNodeIcon() returns a stable module-level icon reference — not a new component */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isGuide
              ? "text-amber-600 dark:text-amber-500"
              : data.nodeKind === "skill"
              ? "text-yellow-600 dark:text-yellow-500"
              : data.nodeKind === "agent"
              ? "text-blue-600 dark:text-blue-500"
              : data.nodeKind === "file"
              ? "text-green-600 dark:text-green-500"
              : "text-muted-foreground"
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "truncate",
            selected ? "font-medium text-brand-900 dark:text-brand-100" : "text-foreground",
            isFolder && "font-medium"
          )}
        >
          {data.label}
        </span>
        {isGuide && (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
            guide
          </span>
        )}
        {data.isReusable && (
          <span className="shrink-0 text-[9px] text-muted-foreground/40" title="Workspace reusable">↗</span>
        )}
      </Link>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-muted-foreground/30 !border-none" />
    </div>
  );
}

const nodeTypes = {
  graphNode: GraphNode,
};

// ─── Build flow data from overview ────────────────────────────────────────────

function buildFlowData(
  overview: BoxOverview,
  scopeFolderId: string | null
): {
  nodes: Node<GraphNodeData>[];
  edges: Edge<GraphEdgeData>[];
} {
  const { nodes: overviewNodes, edges: overviewEdges, box } = overview;
  const guideNoteId = box.guide_note_id;

  // Scope filtering
  let visibleNodes = overviewNodes;
  let visibleEdges = overviewEdges;

  if (scopeFolderId) {
    // BFS to find all nodes in subtree
    const childMap = new Map<string, string[]>();
    for (const n of overviewNodes) {
      if (n.parentId) {
        const arr = childMap.get(n.parentId) ?? [];
        arr.push(n.id);
        childMap.set(n.parentId, arr);
      }
    }
    const scopedIds = new Set<string>();
    const queue = [scopeFolderId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      scopedIds.add(id);
      for (const child of childMap.get(id) ?? []) queue.push(child);
    }
    visibleNodes = overviewNodes.filter((n) => scopedIds.has(n.id));
    const visibleSet = new Set(visibleNodes.map((n) => n.id));
    visibleEdges = overviewEdges.filter(
      (e) => visibleSet.has(e.sourceNoteId) || visibleSet.has(e.targetNoteId)
    );
  }

  // Convert to ReactFlow nodes
  const flowNodes: Node<GraphNodeData>[] = visibleNodes.map((n) => ({
    id: n.id,
    type: "graphNode",
    position: { x: 0, y: 0 }, // will be set by dagre
    data: {
      label: n.label,
      nodeKind: n.kind,
      noteKind: n.noteKind,
      objectId: n.id,
      isGuide: n.id === guideNoteId,
      path: n.path,
      isReusable: n.isReusable,
      isAttachment: n.isAttachment,
    },
  }));

  // Convert to ReactFlow edges
  // Hierarchy edges (parent-child containment)
  const hierarchyEdges: Edge<GraphEdgeData>[] = visibleNodes
    .filter((n) => n.parentId)
    .map((n) => ({
      id: `h:${n.parentId}:${n.id}`,
      source: n.parentId!,
      target: n.id,
      type: "smoothstep",
      animated: false,
      style: { stroke: "var(--color-border)", strokeWidth: 1, opacity: 0.5 },
      data: {
        relationshipType: "contains",
        edgeKind: "hierarchy",
      },
    }));

  // Semantic edges (note_links and object_links)
  const semanticEdges: Edge<GraphEdgeData>[] = visibleEdges.map((e) => ({
    id: `s:${e.id}`,
    source: e.sourceNoteId,
    target: e.targetNoteId,
    type: "default",
    animated: true,
    label: relLabel(e.relationshipType),
    labelStyle: { fontSize: 10, fill: "var(--color-muted-foreground)" },
    labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.8 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    style: {
      stroke: e.edgeKind === "object_link"
        ? "var(--color-info)"
        : (RELATIONSHIP_COLORS[e.relationshipType] ?? "#8b5cf6"),
      strokeWidth: 1.5,
    },
    data: {
      relationshipType: e.relationshipType,
      relationshipNote: e.relationshipNote,
      edgeKind: e.edgeKind,
      sourceType: e.sourceType,
      targetType: e.targetType,
    },
  }));

  const allEdges = [...hierarchyEdges, ...semanticEdges];

  // Apply dagre layout
  const layoutedNodes = applyDagreLayout(flowNodes, allEdges);

  return { nodes: layoutedNodes, edges: allEdges };
}

// ─── Inner graph component (needs ReactFlowProvider) ──────────────────────────

function BoxGraphViewInner({ overview }: { overview: BoxOverview }) {
  const { nodes: overviewNodes } = overview;
  const [scopeFolderId, setScopeFolderId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildFlowData(overview, scopeFolderId),
    [overview, scopeFolderId]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const reactFlow = useReactFlow();

  // Rebuild layout when scope changes
  const prevScopeRef = useMemo(() => ({ scope: scopeFolderId }), [scopeFolderId]);
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setTimeout(() => reactFlow.fitView({ padding: 0.15, duration: 200 }), 50);
  }, [prevScopeRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Node IDs connected by at least one semantic edge
  const connectedIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of initialEdges) {
      if ((e.data as GraphEdgeData | undefined)?.edgeKind !== "hierarchy") {
        s.add(e.source);
        s.add(e.target);
      }
    }
    return s;
  }, [initialEdges]);

  // Apply search highlight + orphan filter on top of layout nodes
  const displayNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return initialNodes
      .filter((n) => {
        if (showOrphansOnly && connectedIds.has(n.id)) return false;
        return true;
      })
      .map((n) => {
        if (!q) return n;
        const matches = (n.data.label as string).toLowerCase().includes(q);
        return {
          ...n,
          style: {
            ...n.style,
            opacity: matches ? 1 : 0.15,
            outline: matches ? "2px solid #8b5cf6" : undefined,
            outlineOffset: matches ? "2px" : undefined,
          },
        };
      });
  }, [initialNodes, searchQuery, showOrphansOnly, connectedIds]);

  const displayEdges = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && !showOrphansOnly) return initialEdges;
    const visibleIds = new Set(displayNodes.map((n) => n.id));
    return initialEdges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => {
        if (!q) return e;
        const srcMatch = displayNodes.find((n) => n.id === e.source)?.style?.opacity === 1;
        const tgtMatch = displayNodes.find((n) => n.id === e.target)?.style?.opacity === 1;
        return { ...e, style: { ...e.style, opacity: srcMatch || tgtMatch ? 1 : 0.1 } };
      });
  }, [initialEdges, searchQuery, showOrphansOnly, displayNodes]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  // Folder options for scope dropdown
  const folderOptions = overviewNodes.filter((n) => n.kind === "folder");

  // Selected node details
  const selectedNode = selectedNodeId ? overviewNodes.find((n) => n.id === selectedNodeId) : null;
  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return { outgoing: [] as OverviewEdge[], incoming: [] as OverviewEdge[] };
    return {
      outgoing: overview.edges.filter((e) => e.sourceNoteId === selectedNodeId),
      incoming: overview.edges.filter((e) => e.targetNoteId === selectedNodeId),
    };
  }, [selectedNodeId, overview.edges]);

  const isEmpty = overviewNodes.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <Share2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="max-w-xs space-y-1">
          <p className="text-sm font-medium text-foreground">No content yet</p>
          <p className="text-sm text-muted-foreground">
            Add notes to this box to see the graph.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Search */}
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Highlight nodes…"
            aria-label="Search and highlight nodes"
            className={cn(
              "h-7 rounded-md border border-input bg-background pl-6 pr-2 text-xs text-foreground w-36",
              "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50"
            )}
          />
        </div>

        {/* Orphan toggle */}
        <button
          type="button"
          onClick={() => setShowOrphansOnly((v) => !v)}
          aria-pressed={showOrphansOnly}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-fast",
            showOrphansOnly
              ? "border-brand-400/70 bg-brand-50 text-brand-700 dark:border-brand-500/60 dark:bg-brand-950/50 dark:text-brand-300"
              : "border-input bg-background text-muted-foreground hover:border-border-strong"
          )}
        >
          <Users className="h-3 w-3" aria-hidden="true" />
          Orphans only
        </button>

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
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-card" /> Note
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-300/70 bg-amber-50/60 dark:border-amber-600/40 dark:bg-amber-900/20" /> Guide
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted/30" /> Folder
          </span>
          <span className="flex items-center gap-1">
            <File className="h-2.5 w-2.5 text-green-600" /> File
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5 text-yellow-600" /> Skill
          </span>
          <span className="flex items-center gap-1">
            <Bot className="h-2.5 w-2.5 text-blue-600" /> Agent
          </span>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="h-[500px] w-full rounded-lg border border-border bg-background overflow-hidden">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={true}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable={true}
          selectNodesOnDrag={false}
          panOnDrag={true}
          zoomOnScroll={true}
          minZoom={0.2}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          colorMode="system"
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeStrokeWidth={2}
            zoomable
            pannable
            className="!bg-background/80 !border !border-border !rounded-md"
          />
        </ReactFlow>
      </div>

      {/* Selected node detail panel */}
      {selectedNode && (
        <div
          className="rounded-lg border border-brand-300/60 bg-card px-4 py-3 shadow-sm dark:border-brand-600/40"
          aria-label="Selected node details"
          aria-live="polite"
        >
          <div className="flex items-start gap-2 mb-2">
            {(() => {
              const Icon = getNodeIcon(selectedNode.kind, selectedNode.noteKind);
              return (
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selectedNode.id === overview.box.guide_note_id
                      ? "text-amber-600 dark:text-amber-500"
                      : "text-muted-foreground"
                  )}
                  aria-hidden="true"
                />
              );
            })()}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={getNodeHref(selectedNode.kind, selectedNode.id)}
                  className="text-sm font-medium text-foreground hover:underline underline-offset-2"
                >
                  {selectedNode.label}
                </Link>
                <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                  {selectedNode.kind}
                </Badge>
                {selectedNode.id === overview.box.guide_note_id && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-[10px] font-normal">
                    <BookOpen className="h-3 w-3" aria-hidden="true" />
                    Guide note
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                {selectedNode.path}
              </p>
            </div>
            <Link
              href={getNodeHref(selectedNode.kind, selectedNode.id)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-fast"
            >
              Open →
            </Link>
          </div>

          {/* Semantic connections */}
          {(selectedEdges.outgoing.length > 0 || selectedEdges.incoming.length > 0) && (
            <div className="space-y-2 border-t border-border/50 pt-2">
              {selectedEdges.outgoing.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Outgoing →
                  </p>
                  <div className="flex flex-col gap-1">
                    {selectedEdges.outgoing.map((edge) => {
                      const target = overviewNodes.find((n) => n.id === edge.targetNoteId);
                      return (
                        <div key={edge.id} className="flex items-center gap-1.5 text-xs">
                          <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                            {relLabel(edge.relationshipType)}
                          </Badge>
                          <Link
                            href={getNodeHref(target?.kind ?? "note", edge.targetNoteId)}
                            className="text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
                          >
                            {target?.label ?? "Object"}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedEdges.incoming.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    → Incoming
                  </p>
                  <div className="flex flex-col gap-1">
                    {selectedEdges.incoming.map((edge) => {
                      const source = overviewNodes.find((n) => n.id === edge.sourceNoteId);
                      return (
                        <div key={edge.id} className="flex items-center gap-1.5 text-xs">
                          <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                            {relLabel(edge.relationshipType)}
                          </Badge>
                          <Link
                            href={getNodeHref(source?.kind ?? "note", edge.sourceNoteId)}
                            className="text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
                          >
                            {source?.label ?? "Object"}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component (wraps in ReactFlowProvider) ──────────────────────────────

interface BoxGraphViewProps {
  overview: BoxOverview;
}

export function BoxGraphView({ overview }: BoxGraphViewProps) {
  return (
    <ReactFlowProvider>
      <BoxGraphViewInner overview={overview} />
    </ReactFlowProvider>
  );
}
