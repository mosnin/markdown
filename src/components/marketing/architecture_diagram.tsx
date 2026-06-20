/* eslint-disable @next/next/no-img-element -- vendored brand SVGs render as static same-origin <img>; next/image adds nothing for these */
import { Eye, GitPullRequestArrow, ShieldCheck, Check, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Reveal } from "@/components/marketing/reveal";

// ─── Product architecture diagram ────────────────────────────────────────────
//
// The whole product in one picture: any MCP agent connects, reads your context,
// and PROPOSES changes — nothing is written to your governed store until you
// approve. Logos ride on white tiles so every brand (light, dark, or colored)
// stays legible on either page theme. Reveals on scroll; otherwise static and
// reduced-motion-safe by construction.

type Logo = { slug: string; name: string; ext?: "svg" | "png" };

const AGENTS: Logo[] = [
  { slug: "claude", name: "Claude" },
  { slug: "openai", name: "ChatGPT" },
  { slug: "cursor", name: "Cursor" },
  { slug: "github-copilot", name: "Copilot" },
  { slug: "windsurf", name: "Windsurf" },
  { slug: "gemini", name: "Gemini" },
  { slug: "cline", name: "Cline" },
  { slug: "vscode", name: "VS Code" },
];

const STORE: Logo[] = [
  { slug: "neon", name: "Neon Postgres" },
  { slug: "redis", name: "Redis" },
];

function LogoTile({ logo, className }: { logo: Logo; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl bg-white px-2.5 py-2 shadow-sm ring-1 ring-black/5",
        className,
      )}
    >
      <img
        src={`/logos/${logo.slug}.${logo.ext ?? "svg"}`}
        alt=""
        className="size-5 shrink-0 object-contain"
        loading="lazy"
        draggable={false}
      />
      <span className="truncate text-xs font-medium text-neutral-700">
        {logo.name}
      </span>
    </div>
  );
}

function StageLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
      {children}
    </p>
  );
}

/** Labelled connector — a horizontal arrow on desktop, a downward one stacked. */
function Connector({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div className="flex shrink-0 items-center justify-center py-2 lg:flex-col lg:py-0">
      <div className="flex flex-col items-center gap-1">
        <span className="rounded-full border border-border/60 bg-card/70 px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-violet-500 shadow-xs backdrop-blur-sm">
          {label}
        </span>
        <ArrowRight
          className="size-4 rotate-90 text-muted-foreground/50 lg:rotate-0"
          aria-hidden="true"
        />
        {sublabel && (
          <span className="text-[10px] text-muted-foreground/50">{sublabel}</span>
        )}
      </div>
    </div>
  );
}

const GATE_ROWS = [
  { icon: Eye, label: "Reads your context", tone: "muted" as const },
  { icon: GitPullRequestArrow, label: "Proposes a change", tone: "muted" as const },
  { icon: ShieldCheck, label: "You approve", tone: "accent" as const },
  { icon: Check, label: "Merged + audited", tone: "ok" as const },
];

export function ArchitectureDiagram({ className }: { className?: string }) {
  return (
    <Reveal
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border/60 bg-muted/20 p-5 sm:p-8",
        className,
      )}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
        {/* Stage 1 — agents */}
        <div className="flex-1 rounded-2xl border border-border/50 bg-card/40 p-4">
          <StageLabel>Your agents</StageLabel>
          <div className="grid grid-cols-2 gap-2">
            {AGENTS.map((logo) => (
              <LogoTile key={logo.slug} logo={logo} />
            ))}
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
            + any MCP client
          </p>
        </div>

        <Connector label="MCP" />

        {/* Stage 2 — the trust gate (centerpiece) */}
        <div className="flex-[1.15] rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-4 shadow-sm">
          <StageLabel>Poggle — the trust gate</StageLabel>
          <div className="flex flex-col gap-2">
            {GATE_ROWS.map((row) => {
              const Icon = row.icon;
              return (
                <div
                  key={row.label}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-3 py-2.5",
                    row.tone === "accent"
                      ? "border-violet-500/40 bg-violet-500/10"
                      : row.tone === "ok"
                        ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                        : "border-border/50 bg-background/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      row.tone === "accent"
                        ? "bg-violet-600 text-white"
                        : row.tone === "ok"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      row.tone === "accent" ? "text-foreground" : "text-foreground/80",
                    )}
                  >
                    {row.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <Connector label="on approval" />

        {/* Stage 3 — governed store */}
        <div className="flex-1 rounded-2xl border border-border/50 bg-card/40 p-4">
          <StageLabel>Your governed store</StageLabel>
          <div className="flex flex-col gap-2">
            {STORE.map((logo) => (
              <LogoTile key={logo.slug} logo={logo} />
            ))}
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/50 px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-violet-500/15 font-mono text-[9px] font-bold text-violet-500">
                pg
              </span>
              <span className="text-xs font-medium text-foreground/70">
                pgvector search
              </span>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground/60">
            Version history · append-only audit
          </p>
        </div>
      </div>
    </Reveal>
  );
}
