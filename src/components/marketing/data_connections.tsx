"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import {
  FileCode2,
  FileText,
  GitPullRequestArrow,
  Tag,
  type LucideIcon,
} from "lucide-react";

import { PixelGridShader } from "@/components/shaders/pixelgrid-shader";
import { cn } from "@/lib/utils";

// ─── Data-connection examples ────────────────────────────────────────────────
//
// Three hand-built micro–knowledge-graphs that show, concretely, how data
// connects together inside Poggle: entities tying notes together, a change
// tracing back to its decision, and one thread stitched across boxes.
//
// The cards are frosted glass floating over a single living pixel-grid shader
// "field" — the connective medium made visible. Crisp opaque nodes + thin
// curved edges sit on top so the data stays perfectly legible while the field
// breathes behind it. One shader instance keeps it cheap; it's mount-gated and
// disabled under reduced motion (the scrims alone remain).

type Pt = { x: number; y: number };

type GraphNode = Pt & {
  id: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  accent?: boolean;
};

type GraphEdge = { from: string; to: string; label?: string; bow?: number };

type Example = {
  title: string;
  caption: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const EXAMPLES: Example[] = [
  {
    title: "Entities tie notes together",
    caption:
      "Poggle pulls out the systems, people, and concepts that recur — then links every note that mentions them. Agents assemble precise context instead of grepping a flat pile of documents.",
    nodes: [
      { id: "ent", label: "Auth service", icon: Tag, x: 50, y: 50, accent: true },
      { id: "spec", label: "Auth spec", icon: FileText, x: 17, y: 22 },
      { id: "inc", label: "Incident #482", icon: FileText, x: 83, y: 24 },
      { id: "run", label: "On-call runbook", icon: FileText, x: 20, y: 80 },
      { id: "rot", label: "Rotation policy", icon: FileText, x: 84, y: 78 },
    ],
    edges: [
      { from: "spec", to: "ent", bow: 4 },
      { from: "inc", to: "ent", bow: -4 },
      { from: "run", to: "ent", bow: -4 },
      { from: "rot", to: "ent", bow: 4 },
    ],
  },
  {
    title: "Every change traces to a decision",
    caption:
      "A proposal cites the notes it touches, and the graph keeps the trail — so you can follow any edit back to the decision behind it, and roll it back if it was wrong.",
    nodes: [
      { id: "pr", label: "PR #1290", icon: GitPullRequestArrow, x: 16, y: 30, accent: true },
      { id: "adr", label: "ADR-017", icon: FileText, x: 50, y: 62 },
      { id: "arch", label: "architecture.md", icon: FileCode2, x: 84, y: 30 },
    ],
    edges: [
      { from: "pr", to: "adr", label: "references", bow: 7 },
      { from: "adr", to: "arch", label: "updates", bow: 7 },
    ],
  },
  {
    title: "One thread across every box",
    caption:
      "An entity stitches a story together across boxes — while each agent still sees only the boxes you scoped it to. Connection, never exposure.",
    nodes: [
      { id: "acme", label: "Acme Corp", icon: Tag, x: 50, y: 48, accent: true },
      { id: "sup", label: "Support ticket", sub: "Support", icon: FileText, x: 18, y: 24 },
      { id: "gtm", label: "Renewal brief", sub: "Go-to-market", icon: FileText, x: 82, y: 26 },
      { id: "eng", label: "Bug #77", sub: "Engineering", icon: FileText, x: 50, y: 84 },
    ],
    edges: [
      { from: "sup", to: "acme", bow: 4 },
      { from: "gtm", to: "acme", bow: -4 },
      { from: "eng", to: "acme", bow: 0 },
    ],
  },
];

// Quadratic-bezier edge between two points, gently bowed perpendicular to the
// line. Coordinates live in the 0–100 space of the SVG viewBox.
function edgePath(a: Pt, b: Pt, bow = 0): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

// Midpoint of that quadratic (t = 0.5), where an edge label sits.
function edgeMid(a: Pt, b: Pt, bow = 0): Pt {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y };
}

function ConnectionGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const byId = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="relative h-52 w-full sm:h-56">
      {/* Edges — thin curved connectors, drawn behind the nodes. */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full text-violet-500/45"
        aria-hidden="true"
      >
        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          return (
            <path
              key={i}
              d={edgePath(a, b, e.bow)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {/* Edge labels */}
      {edges.map((e, i) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b || !e.label) return null;
        const mid = edgeMid(a, b, e.bow);
        return (
          <span
            key={`l-${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm"
            style={{ left: `${mid.x}%`, top: `${mid.y}%` }}
          >
            {e.label}
          </span>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const Icon = n.icon;
        return (
          <div
            key={n.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
          >
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1 shadow-sm",
                n.accent
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-600 shadow-violet-500/10 ring-1 ring-violet-500/15 dark:text-violet-300"
                  : "border-border/70 bg-card text-foreground",
              )}
            >
              <Icon
                className={cn("size-3.5 shrink-0", n.accent ? "text-violet-500" : "text-muted-foreground")}
                aria-hidden="true"
              />
              <div className="leading-tight">
                <span className="block text-[11px] font-medium">{n.label}</span>
                {n.sub && (
                  <span className="block text-[9px] font-normal text-muted-foreground">{n.sub}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ShaderField() {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {mounted && !reduceMotion ? (
        <div className="absolute inset-0 opacity-30">
          <PixelGridShader
            shape="plasma"
            matrix="bayer8"
            colorFg="#8b5cf6"
            pxSize={6}
            amplitude={0.5}
            frequency={0.6}
            speed={0.35}
            rings={4}
          />
        </div>
      ) : null}
      {/* Knock the field back so the cards stay crisp and legible. */}
      <div className="absolute inset-0 bg-background/55" />
    </div>
  );
}

export function DataConnections({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[2rem] border border-border/50 bg-muted/10 p-4 sm:p-6",
        className,
      )}
    >
      <ShaderField />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {EXAMPLES.map((ex) => (
          <div
            key={ex.title}
            className="group flex flex-col rounded-3xl border border-border/60 bg-background/40 p-5 backdrop-blur-md transition-colors duration-300 hover:border-border hover:bg-background/55"
          >
            <ConnectionGraph nodes={ex.nodes} edges={ex.edges} />
            <h3 className="mt-4 font-hero text-base font-semibold text-foreground">{ex.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{ex.caption}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
