/* eslint-disable @next/next/no-img-element -- vendored brand SVGs render as static same-origin <img> */
import { Boxes, Eye, GitPullRequestArrow, ArrowRight, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/marketing/reveal";

// ─── Connection-topology diagram ─────────────────────────────────────────────
//
// Many agents, one scoped door. Any number of MCP clients connect through a
// single OAuth-scoped endpoint that only grants read/propose on the boxes you
// choose — never write or delete. Logos ride on white tiles for theme safety.

const CLIENTS = [
  "claude",
  "openai",
  "cursor",
  "github-copilot",
  "windsurf",
  "gemini",
  "cline",
  "kilocode",
  "opencode",
  "kimi",
  "grok",
  "manus",
] as const;

const BOXES: { name: string; scopes: ("read" | "propose")[] }[] = [
  { name: "Engineering", scopes: ["read", "propose"] },
  { name: "Support", scopes: ["read"] },
  { name: "Go-to-market", scopes: ["read", "propose"] },
];

function StageLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
      {children}
    </p>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 py-1 lg:py-0">
      <span className="rounded-full border border-border/60 bg-card/70 px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-violet-500 shadow-xs backdrop-blur-sm">
        {label}
      </span>
      <ArrowRight
        className="size-4 rotate-90 text-muted-foreground/50 lg:rotate-0"
        aria-hidden="true"
      />
    </div>
  );
}

function ScopeChip({
  icon: Icon,
  label,
}: {
  icon: typeof Eye;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-500">
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function ConnectionTopology({ className }: { className?: string }) {
  return (
    <Reveal
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border/60 bg-muted/20 p-5 sm:p-8",
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        {/* Agents fan */}
        <div className="flex-1 rounded-2xl border border-border/50 bg-card/40 p-4">
          <StageLabel>Any agents</StageLabel>
          <div className="grid grid-cols-4 gap-2">
            {CLIENTS.map((slug) => (
              <div
                key={slug}
                className="flex aspect-square items-center justify-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5"
              >
                <img
                  src={`/logos/${slug}.svg`}
                  alt=""
                  className="size-6 object-contain"
                  loading="lazy"
                  draggable={false}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
            + any MCP client
          </p>
        </div>

        <Connector label="OAuth 2.1" />

        {/* Single scoped endpoint */}
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-4 text-center shadow-sm lg:w-52">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <img
              src="/logos/mcp.svg"
              alt="Model Context Protocol"
              className="size-7 object-contain"
              loading="lazy"
              draggable={false}
            />
          </div>
          <p className="text-sm font-semibold text-foreground">One MCP endpoint</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            A scoped token — per box, per capability
          </p>
        </div>

        <Connector label="scoped" />

        {/* Boxes with scopes */}
        <div className="flex-1 rounded-2xl border border-border/50 bg-card/40 p-4">
          <StageLabel>Only the boxes you allow</StageLabel>
          <div className="flex flex-col gap-2">
            {BOXES.map((box) => (
              <div
                key={box.name}
                className="rounded-xl border border-border/50 bg-background/50 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Boxes className="size-4 shrink-0 text-violet-500" aria-hidden="true" />
                    {box.name}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {box.scopes.includes("read") && <ScopeChip icon={Eye} label="read" />}
                    {box.scopes.includes("propose") && (
                      <ScopeChip icon={GitPullRequestArrow} label="propose" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/60">
              <Lock className="size-3" aria-hidden="true" />
              Write &amp; delete — never
            </p>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
