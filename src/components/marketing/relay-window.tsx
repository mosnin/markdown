"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Mark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/hydrated";

/* ==========================================================================
   The product window in the hero: Poggle as it is, not a stock screenshot.
   An agent rail down the left showing who is working right now, the handoff
   brief in the middle, and the live session log down the right edge. Every
   few seconds a new event lands on the log with the one celebratory motion
   the design language allows, a single ring (§7.3).

   The scene is the product's whole argument in one frame: two agents on two
   different plans, one of them capped, and the brief that carries the work
   across the gap between them.
   ========================================================================== */

type Agent = {
  id: string;
  tool: string;
  plan: string;
  status: "active" | "idle" | "capped";
  intent: string;
};

const AGENTS: Agent[] = [
  {
    id: "a1",
    tool: "Claude Code",
    plan: "plan-a",
    status: "capped",
    intent: "Idempotent charges",
  },
  {
    id: "a2",
    tool: "Codex",
    plan: "plan-b",
    status: "active",
    intent: "Retry middleware",
  },
  {
    id: "a3",
    tool: "Cursor",
    plan: "sam",
    status: "active",
    intent: "Replay tests",
  },
];

type LogEntry = {
  seq: string;
  type: string;
  message: string;
  author: string;
  agent: boolean;
  /** Salience 0–5. Drives the mark, exactly as it does in the product. */
  importance: number;
};

const HISTORY: LogEntry[] = [
  {
    seq: "#0141",
    type: "decision",
    message: "Key on (merchant_id, request_id), not a body hash",
    author: "Claude Code · plan-a",
    agent: true,
    importance: 5,
  },
  {
    seq: "#0140",
    type: "blocker",
    message: "Stripe test mode dedupes replays within 60s",
    author: "Claude Code · plan-a",
    agent: true,
    importance: 5,
  },
  {
    seq: "#0139",
    type: "file_edit",
    message: "src/charges/create.ts",
    author: "Codex · plan-b",
    agent: true,
    importance: 2,
  },
];

const INCOMING: LogEntry = {
  seq: "#0142",
  type: "usage_limit",
  message: "Session stopped on a usage cap — work unfinished",
  author: "Claude Code · plan-a",
  agent: true,
  importance: 5,
};

const BRIEF: { label: string; value: string }[] = [
  {
    label: "Why the last session stopped",
    value: "Usage cap on plan-a, 3h in. The work was not finished.",
  },
  {
    label: "Blocked / already tried",
    value:
      "Stripe test mode dedupes identical keys within 60s, so the replay assertion is vacuous.",
  },
  {
    label: "Decisions already made",
    value:
      "Key on (merchant_id, request_id). Return 200 with the original charge on replay, not 409.",
  },
  {
    label: "In flight",
    value: "Retry middleware half-written in src/charges/retry.ts.",
  },
  {
    label: "Next steps",
    value: "Finish the middleware, then add the replay integration test.",
  },
];

const STATUS_DOT: Record<Agent["status"], string> = {
  active: "border-positive bg-positive",
  idle: "border-strong bg-raised",
  capped: "border-critical bg-critical-wash",
};

export function RelayWindow({ className }: { className?: string }): ReactNode {
  const reduced = useReducedMotion();
  const hydrated = useHydrated();
  const [animationLanded, setLanded] = useState(false);
  // The server cannot know the viewer's motion preference. Keep its first
  // frame stable, then show the completed state for reduced-motion viewers.
  const landed = animationLanded || (hydrated && Boolean(reduced));

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = (next: boolean): void => {
      timer = setTimeout(
        () => {
          if (cancelled) return;
          setLanded(next);
          loop(!next);
        },
        next ? 2600 : 4400,
      );
    };
    loop(true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reduced]);

  const log = landed ? [INCOMING, ...HISTORY] : HISTORY;

  return (
    <div
      className={cn(
        "flex h-[600px] w-[1040px] overflow-hidden rounded-12 border border-border bg-raised text-ink",
        className,
      )}
      aria-hidden="true"
    >
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-hairline bg-rail">
        <div className="flex h-[44px] items-center gap-3 border-b border-hairline px-5">
          <Mark size={14} />
          <span className="t-mk-ill-13s">acme/checkout</span>
        </div>
        <div className="flex flex-col gap-1 p-3">
          <p className="t-label-caps px-3 pb-2 pt-3 text-ink-3">
            Agents on this repo
          </p>
          {AGENTS.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex flex-col gap-1 rounded-6 px-3 py-2",
                a.status === "capped" ? "bg-inset" : "",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn("size-[7px] shrink-0 rounded-full border", STATUS_DOT[a.status])}
                />
                <span className="t-mk-ill-12 flex-1 text-ink">{a.tool}</span>
                <span className="t-mk-ill-mono-11 text-ink-4">{a.plan}</span>
              </div>
              <span className="t-mk-ill-11 pl-[19px] text-ink-3">
                {a.status === "capped" ? "capped — handed off" : a.intent}
              </span>
            </div>
          ))}
          <p className="t-label-caps px-3 pb-2 pt-6 text-ink-3">Claims</p>
          <div className="flex flex-col gap-1 px-3">
            <span className="t-mk-ill-mono-11 text-ink-2">
              src/charges/retry.ts
            </span>
            <span className="t-mk-ill-11 text-ink-4">held by Codex · 12m</span>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[44px] items-center justify-between border-b border-hairline px-6">
          <div className="flex items-center gap-3 text-ink-3">
            <span className="t-mk-ill-12">acme/checkout</span>
            <span className="t-mk-ill-12 text-ink-4">/</span>
            <span className="t-mk-ill-12 text-ink">Handoff brief</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="t-mk-ill-mono-11 rounded-4 bg-inset px-2 py-1 text-ink-2">
              feat/idempotent-charges
            </span>
            <span className="t-mk-ill-12s rounded-full bg-inverse px-4 py-1 text-ink-inverse">
              Resume
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col gap-6 p-7">
            <div className="flex flex-col gap-2">
              <p className="t-label-caps text-ink-3">
                Assembled for Codex · 1,840 of 4,000 tokens
              </p>
              <p className="t-mk-ill-15s">
                You are picking up work already in progress
              </p>
            </div>
            <div className="flex flex-col divide-y divide-hairline rounded-8 border border-hairline bg-object">
              {BRIEF.map((f) => (
                <div key={f.label} className="flex flex-col gap-1 px-5 py-4">
                  <span className="t-label-caps text-ink-3">{f.label}</span>
                  <span className="t-mk-ill-13 text-ink">{f.value}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 rounded-8 border border-hairline bg-inset px-5 py-3">
              <span className="t-mk-ill-12 text-ink-3">Injected at</span>
              <span className="t-mk-ill-12 flex-1 text-ink">
                {landed ? "SessionStart — before it read a single file" : "SessionStart — before it read a sin"}
                {!landed ? (
                  <span
                    data-mk-motion
                    className="ml-px inline-block h-[12px] w-px translate-y-[2px] bg-ink [animation:mk-caret_1s_steps(1)_infinite]"
                  />
                ) : null}
              </span>
            </div>
          </div>

          <aside className="w-[252px] shrink-0 border-l border-hairline bg-rail p-6">
            <p className="t-label-caps pb-5 text-ink-3">Live session log</p>
            <ol className="relative flex flex-col">
              <span className="absolute bottom-3 left-[7px] top-3 w-px bg-hairline" />
              {log.map((entry, i) => (
                <li key={entry.seq} className="relative flex gap-5 pb-6 last:pb-0">
                  <span className="relative mt-[3px] flex size-[15px] shrink-0 items-center justify-center">
                    {i === 0 && landed ? (
                      <span
                        data-mk-motion
                        className="absolute inset-0 rounded-4 border border-critical [animation:ledger-commit-pulse_600ms_var(--ease-out)_1]"
                      />
                    ) : null}
                    {/* Salience is the product's central opinion, so the mark
                        carries it: a 5 reads as signal, a 2 as texture. */}
                    <span
                      className={cn(
                        "size-[9px] border",
                        entry.agent ? "rounded-2" : "rounded-full",
                        i === 0 && landed
                          ? "border-critical bg-critical-wash"
                          : entry.importance >= 5
                            ? "border-agent bg-agent-wash"
                            : "border-strong bg-raised",
                      )}
                    />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <span className="t-mk-ill-mono-11 text-ink">
                        {entry.seq}
                      </span>
                      <span className="t-mk-ill-mono-11 text-ink-4">
                        {entry.type}
                      </span>
                    </div>
                    <span className="t-mk-ill-12 text-ink">{entry.message}</span>
                    <span
                      className={cn(
                        "t-mk-ill-11",
                        entry.agent ? "text-agent-text" : "text-ink-3",
                      )}
                    >
                      {entry.author}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </section>
    </div>
  );
}
