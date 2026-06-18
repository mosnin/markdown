"use client";

import Link from "next/link";
import { ArrowRight, Box, Check, Inbox, Plug } from "lucide-react";
import * as m from "motion/react-m";
import { cn } from "@/lib/utils";
import { staggerContainer, fadeRise, tween } from "@/lib/motion";

/**
 * First-run activation checklist.
 *
 * The brand's loop in three concrete steps — create a box → connect an agent →
 * review an AI Edit — driven by real workspace state. Self-hides once all three
 * are done, so a fully-activated user never sees a redundant "all green" card.
 */

interface Props {
  box: boolean;
  agent: boolean;
  edit: boolean;
  /** Pending proposals awaiting review — sharpens the third step's CTA. */
  pendingCount?: number;
}

const STEPS = [
  {
    id: "box" as const,
    label: "Create your first box",
    desc: "Give your agents a place to read from.",
    icon: Box,
    href: "/app/workspaces",
    cta: "Create a box",
  },
  {
    id: "agent" as const,
    label: "Connect an agent",
    desc: "Bring Claude, Cursor, or any MCP client.",
    icon: Plug,
    href: "/app/connect",
    cta: "Connect",
  },
  {
    id: "edit" as const,
    label: "Review your first AI Edit",
    desc: "Approve what an agent proposes — nothing lands until you do.",
    icon: Inbox,
    href: "/app/proposals",
    cta: "Open AI Edits",
  },
];

export function OnboardingChecklist({ box, agent, edit, pendingCount = 0 }: Props) {
  const status: Record<"box" | "agent" | "edit", boolean> = { box, agent, edit };
  const doneCount = [box, agent, edit].filter(Boolean).length;

  // Fully activated — don't show a redundant all-complete card.
  if (doneCount === 3) return null;

  const firstIncomplete = STEPS.find((s) => !status[s.id])?.id;

  return (
    <m.div
      initial="hidden"
      animate="visible"
      variants={fadeRise}
      className="overflow-hidden rounded-2xl border border-border/60 bg-card/60"
    >
      {/* Header + progress */}
      <div className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-4">
        <div>
          <h2 className="font-hero text-base font-semibold text-foreground">Get set up</h2>
          <p className="text-xs text-muted-foreground">
            Three steps to your first governed AI edit.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs text-muted-foreground">{doneCount}/3</span>
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:w-24">
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${(doneCount / 3) * 100}%` }}
              transition={tween.normal}
              className="h-full rounded-full bg-violet-500"
            />
          </div>
        </div>
      </div>

      {/* Steps */}
      <m.ul
        variants={staggerContainer(0.06, 0.05)}
        initial="hidden"
        animate="visible"
        className="list-none divide-y divide-border/40"
      >
        {STEPS.map((s) => {
          const done = status[s.id];
          const isCurrent = s.id === firstIncomplete;
          const Icon = s.icon;
          const ctaLabel =
            s.id === "edit" && pendingCount > 0 ? `Review ${pendingCount}` : s.cta;
          return (
            <m.li
              key={s.id}
              variants={fadeRise}
              className={cn(
                "flex items-center gap-3.5 px-5 py-3.5",
                !done && !isCurrent && "opacity-55",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                  done ? "bg-emerald-500/15 text-emerald-500" : "bg-violet-500/10 text-violet-500",
                )}
              >
                {done ? (
                  <Check className="size-5" aria-hidden="true" />
                ) : (
                  <Icon className="size-[18px]" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    done ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {s.label}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
              {!done && (
                <Link
                  href={s.href}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    isCurrent
                      ? "bg-violet-600 text-white hover:bg-violet-500"
                      : "border border-border/70 text-foreground/80 hover:bg-accent",
                  )}
                >
                  {ctaLabel}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </m.li>
          );
        })}
      </m.ul>
    </m.div>
  );
}
