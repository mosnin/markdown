"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

import { ClosingPlasma } from "@/components/ui/closing-plasma";
import {
  TerminalAnimationRoot,
  TerminalAnimationTabList,
  TerminalAnimationTabTrigger,
  TerminalAnimationWindow,
  TerminalAnimationContent,
  TerminalAnimationCommandBar,
  TerminalAnimationOutput,
  TerminalAnimationTrailingPrompt,
  TerminalAnimationBlinkingCursor,
  type TabContent,
} from "@/components/ui/terminal-animation";
import { Reveal } from "@/components/marketing/reveal";

// ─── Interactive terminal showcase ───────────────────────────────────────────
//
// The governed loop, live in a terminal — connect, read, propose, approve —
// floating over a closing-plasma shader. Click the tabs to replay each step.
// The plasma mounts after hydration and freezes under reduced-motion; the
// terminal types itself out and is fully clickable.

const TABS: TabContent[] = [
  {
    label: "connect",
    command: "poggle connect --agent claude",
    lines: [
      { text: "", delay: 80 },
      { text: "  ✓ OAuth 2.1 — scoped token minted", color: "text-emerald-400", delay: 420 },
      { text: "  → scope: read, propose", color: "text-sky-300", delay: 200 },
      { text: "  → boxes: Engineering, Support", color: "text-neutral-400", delay: 150 },
      { text: "", delay: 120 },
      { text: "  Connected over MCP.", color: "text-violet-300", delay: 300 },
    ],
  },
  {
    label: "read",
    command: "mcp call read_context --box Engineering",
    lines: [
      { text: "", delay: 80 },
      { text: "  Assembling context bundle…", color: "text-neutral-400", delay: 420 },
      { text: "  ✓ guide note + 12 notes · 1,240 tokens", color: "text-emerald-400", delay: 350 },
      { text: "  → API design · Rate limits · Runbooks", color: "text-neutral-400", delay: 150 },
      { text: "", delay: 120 },
      { text: "  Read-only. Nothing modified.", color: "text-sky-300", delay: 260 },
    ],
  },
  {
    label: "propose",
    command: "mcp call create_write_proposal --note rate-limits.md",
    lines: [
      { text: "", delay: 80 },
      { text: "  + 1,000 requests / min per token", color: "text-emerald-400", delay: 320 },
      { text: "  + Burst: 50 / sec, then 429", color: "text-emerald-400", delay: 150 },
      { text: "  - Legacy per-IP quota note", color: "text-red-400", delay: 150 },
      { text: "", delay: 120 },
      { text: "  ⏳ Proposal #312 queued for review", color: "text-violet-300", delay: 320 },
      { text: "  Write blocked until a human approves.", color: "text-neutral-400", delay: 240 },
    ],
  },
  {
    label: "approve",
    command: "# you review the diff, then approve",
    lines: [
      { text: "", delay: 80 },
      { text: "  ✓ Approved by you@team", color: "text-emerald-400", delay: 360 },
      { text: "  ✓ Merged to main · v7", color: "text-emerald-400", delay: 200 },
      { text: "  ✓ Logged to append-only audit", color: "text-sky-300", delay: 200 },
      { text: "", delay: 120 },
      { text: "  Source of truth updated — reversibly.", color: "text-violet-300", delay: 300 },
    ],
  },
];

export function TerminalShowcase() {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  return (
    <Reveal className="relative overflow-hidden rounded-3xl border border-border/60">
      {/* Plasma shader backdrop */}
      {mounted ? (
        <ClosingPlasma
          themeMode="dark"
          className="absolute inset-0"
          speed={reduceMotion ? 0 : 0.7}
          grain={0.6}
          interactive={!reduceMotion}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-950" />
      )}

      {/* Terminal */}
      <div className="relative z-10 px-4 py-12 sm:px-10 sm:py-16">
        <TerminalAnimationRoot
          tabs={TABS}
          alwaysDark
          hideCursorOnComplete
          className="mx-auto w-full max-w-2xl"
        >
          {/* Tabs */}
          <TerminalAnimationTabList className="flex flex-wrap gap-1 px-2">
            {TABS.map((tab, i) => (
              <TerminalAnimationTabTrigger
                key={tab.label}
                index={i}
                className="rounded-t-lg border border-b-0 border-transparent px-3 py-1.5 font-mono text-[11px] text-white/50 transition-colors hover:text-white/80 data-[state=active]:border-white/10 data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
              >
                {tab.label}
              </TerminalAnimationTabTrigger>
            ))}
          </TerminalAnimationTabList>

          {/* Window */}
          <TerminalAnimationWindow
            backgroundColor="#0a0a0f"
            minHeight="20rem"
            className="rounded-xl rounded-tl-none border border-white/10 shadow-2xl shadow-black/40"
          >
            {/* chrome */}
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
              <span className="size-2.5 rounded-full bg-red-400/70" />
              <span className="size-2.5 rounded-full bg-amber-400/70" />
              <span className="size-2.5 rounded-full bg-emerald-400/70" />
              <span className="ml-2 font-mono text-[11px] text-white/40">
                poggle — mcp
              </span>
            </div>

            <TerminalAnimationContent className="px-5 py-5 font-mono text-[12.5px] leading-relaxed text-white/90 sm:px-7">
              <div className="flex">
                <span className="shrink-0 text-violet-400">poggle&nbsp;❯</span>
                <TerminalAnimationCommandBar className="ml-2 text-white" />
              </div>

              <TerminalAnimationOutput
                className="mt-2 whitespace-pre-wrap"
                renderLine={(line, _i, visible) =>
                  visible ? (
                    <div className={line.color ?? "text-white/80"}>
                      {line.text || " "}
                    </div>
                  ) : null
                }
              />

              <TerminalAnimationTrailingPrompt className="mt-2 flex items-center">
                <span className="shrink-0 text-violet-400">poggle&nbsp;❯</span>
                <TerminalAnimationBlinkingCursor className="bg-white/70" />
              </TerminalAnimationTrailingPrompt>
            </TerminalAnimationContent>
          </TerminalAnimationWindow>
        </TerminalAnimationRoot>
      </div>
    </Reveal>
  );
}
