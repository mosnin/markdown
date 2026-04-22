"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

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
  person: "#3b82f6",       // blue
  project: "#8b5cf6",      // violet
  concept: "#f59e0b",      // amber
  organization: "#10b981", // emerald
  event: "#f43f5e",        // rose
  decision: "#6366f1",     // indigo
  other: "#6b7280",        // gray
};

export function KnowledgeGraphVisual({ entities, edges }: KnowledgeGraphVisualProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

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

  if (entities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No entities to visualize. Save some notes first.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full bg-muted/10">
      <ForceGraph2D
        graphData={graphData}
        width={size.width}
        height={size.height}
        nodeLabel={(node: any) => `${node.name} (${node.entity_type}) — ${node.mention_count} mention${node.mention_count === 1 ? "" : "s"}`}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const label = node.name as string;
          const fontSize = Math.max(10, 12 / globalScale);
          const radius = Math.max(3, 2 + node.val * 1.5);

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
        }}
        linkColor={() => "rgba(139, 92, 246, 0.3)"}
        linkWidth={(link: any) => Math.max(0.5, (link.confidence ?? 1) * 2)}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        onNodeClick={(node: any) => {
          router.push(`/app/entities/${node.id}`);
        }}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
