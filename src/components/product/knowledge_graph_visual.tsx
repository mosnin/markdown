"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ssr: false — the force-graph library depends on canvas/DOM and
// cannot run server-side. We dynamic-import with no SSR so Next.js
// doesn't try to render it on the server.
const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> }
);

export type EntityNode = {
  id: string;
  name: string;
  entity_type: "person" | "project" | "concept" | "organization" | "event" | "decision" | "other";
  mention_count: number;
};

export type EntityEdgeLink = {
  source: string;
  target: string;
  edge_type: string;
  confidence: number;
};

interface KnowledgeGraphVisualProps {
  entities: EntityNode[];
  edges: EntityEdgeLink[];
}

const TYPE_COLORS: Record<EntityNode["entity_type"], string> = {
  person:       "#3b82f6", // blue
  project:      "#8b5cf6", // violet
  concept:      "#f59e0b", // amber
  organization: "#10b981", // emerald
  event:        "#f43f5e", // rose
  decision:     "#6366f1", // indigo
  other:        "#6b7280", // gray
};

// Edge colors by relationship type (matches box_graph_view palette)
const EDGE_TYPE_COLORS: Record<string, string> = {
  related:       "rgba(139, 92, 246, 0.45)",  // violet
  depends_on:    "rgba(239, 68, 68, 0.45)",   // red
  parent_of:     "rgba(59, 130, 246, 0.45)",  // blue
  child_of:      "rgba(96, 165, 250, 0.45)",  // light blue
  reference_for: "rgba(16, 185, 129, 0.45)",  // emerald
  extends:       "rgba(99, 102, 241, 0.45)",  // indigo
  example_of:    "rgba(245, 158, 11, 0.45)",  // amber
  sibling_of:    "rgba(148, 163, 184, 0.45)", // slate
  supersedes:    "rgba(244, 63, 94, 0.45)",   // rose
  derived_from:  "rgba(167, 139, 250, 0.45)", // purple
};

export function KnowledgeGraphVisual({ entities, edges }: KnowledgeGraphVisualProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    function resize() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Matching node IDs for search highlight
  const matchingIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return new Set(entities.filter((e) => e.name.toLowerCase().includes(q)).map((e) => e.id));
  }, [searchQuery, entities]);

  const graphData = useMemo(() => ({
    nodes: entities.map((e) => ({
      id: e.id,
      name: e.name,
      entity_type: e.entity_type,
      mention_count: e.mention_count,
      val: Math.log1p(e.mention_count) + 1,
      color: TYPE_COLORS[e.entity_type],
    })),
    links: edges.map((e) => ({
      source: e.source,
      target: e.target,
      edge_type: e.edge_type,
      confidence: e.confidence,
    })),
  }), [entities, edges]);

  const handleNodeClick = useCallback((node: any) => {
    router.push(`/app/entities/${node.id}`);
  }, [router]);

  if (entities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No entities to visualize. Save some notes first.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Highlight entities…"
          aria-label="Search and highlight entities"
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="text-muted-foreground/60 hover:text-muted-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div ref={containerRef} className="flex-1 bg-muted/10">
        <ForceGraph2D
          graphData={graphData}
          width={size.width}
          height={size.height - 36}
          nodeLabel={(node: any) => `${node.name} (${node.entity_type}) — ${node.mention_count} mention${node.mention_count === 1 ? "" : "s"}`}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.name as string;
            const fontSize = Math.max(10, 12 / globalScale);
            const radius = Math.max(3, 2 + node.val * 1.5);
            const isMatch = matchingIds ? matchingIds.has(node.id) : true;
            const alpha = matchingIds ? (isMatch ? 1 : 0.15) : 1;

            ctx.globalAlpha = alpha;

            // Highlight ring for matching nodes
            if (isMatch && matchingIds) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, radius + 3, 0, 2 * Math.PI);
              ctx.strokeStyle = "#8b5cf6";
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }

            // Node circle
            ctx.fillStyle = node.color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
            ctx.fill();

            // Label
            if (globalScale > 0.8) {
              ctx.font = `${fontSize}px sans-serif`;
              ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(label, node.x, node.y + radius + 2);
            }

            ctx.globalAlpha = 1;
          }}
          linkColor={(link: any) => EDGE_TYPE_COLORS[link.edge_type] ?? "rgba(139, 92, 246, 0.3)"}
          linkWidth={(link: any) => Math.max(0.5, (link.confidence ?? 1) * 2)}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
        />
      </div>
    </div>
  );
}
