"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, Plus } from "lucide-react";
import * as m from "motion/react-m";
import { useReducedMotion } from "motion/react";
import { type Box } from "@/server/domain/types/box";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/product/count_up";
import { SpotlightCard } from "@/components/product/spotlight_card";
import { CreateBoxDialog } from "@/components/product/create/create_box_dialog";
import { cn } from "@/lib/utils";

// ─── Motion helpers (ported verbatim from the reference dashboard) ───────────

const containerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.07,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

// ─── Tiny inline relative-date formatter (no new deps) ───────────────────────

/**
 * "Updated 3 days ago" style label. `nowMs` is frozen once per render (see
 * BoxesBento) so the server render and the client hydration tick agree and we
 * don't trip a hydration mismatch at a day boundary.
 */
function formatUpdated(iso: string, nowMs: number): string {
  const diffDays = Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000);
  if (diffDays <= 0) return "Updated today";
  if (diffDays === 1) return "Updated yesterday";
  if (diffDays < 7) return `Updated ${diffDays} days ago`;
  if (diffDays < 30) return `Updated ${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `Updated ${Math.floor(diffDays / 30)} months ago`;
  return `Updated ${Math.floor(diffDays / 365)} years ago`;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface BoxesBentoProps {
  boxes: Box[];
  workspaceName: string;
}

// ─── Box card ──────────────────────────────────────────────────────────────

function BoxCard({ box, nowMs }: { box: Box; nowMs: number }) {
  return (
    <m.div variants={cardVariants} className="h-full">
      <Link href={`/app/boxes/${box.id}`} className="group block h-full">
        <SpotlightCard
          className={cn(
            "h-full border-0 bg-card",
            "shadow-[0_2px_12px_-2px_rgba(0,0,0,0.07),0_1px_4px_-1px_rgba(0,0,0,0.05)]",
            "transition-shadow duration-300 hover:shadow-[0_8px_32px_-4px_rgba(139,92,246,0.22),0_2px_8px_-2px_rgba(0,0,0,0.08)]"
          )}
        >
          <div className="flex h-full flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Boxes className="h-5 w-5" aria-hidden="true" />
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">{box.name}</p>
              {box.description && (
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                  {box.description}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-xs text-muted-foreground">
                {formatUpdated(box.updated_at, nowMs)}
              </span>
            </div>
          </div>
        </SpotlightCard>
      </Link>
    </m.div>
  );
}

// ─── Bento ─────────────────────────────────────────────────────────────────

export function BoxesBento({ boxes, workspaceName }: BoxesBentoProps) {
  const reduce = useReducedMotion();
  // Freeze "now" once for this render pass so relative-date labels are stable
  // between the server-rendered HTML and the client hydration tick.
  const [nowMs] = useState(() => Date.now());

  return (
    <m.div
      variants={containerVariants}
      initial={reduce ? "show" : "hidden"}
      animate="show"
      className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6"
    >
      {/* ── HERO tile (full width) ──────────────────────────────────────── */}
      <m.div
        variants={cardVariants}
        className={cn(
          "relative overflow-hidden rounded-3xl bg-card",
          "shadow-[0_2px_12px_-2px_rgba(0,0,0,0.07),0_1px_4px_-1px_rgba(0,0,0,0.05)]"
        )}
      >
        {/* Violet radial accent — bottom-right */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 90% 110%, rgba(139,92,246,0.18) 0%, transparent 65%)",
          }}
        />
        {/* Top-left soft violet smear */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full opacity-20"
          style={{
            background:
              "radial-gradient(circle, rgba(139,92,246,0.35) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        {/* Bottom hairline */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(139,92,246,0.5) 50%, transparent)",
          }}
        />

        <div className="relative z-10 flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between lg:p-10">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-primary">
              {workspaceName}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Your boxes
            </h1>
            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-6xl font-semibold tabular-nums tracking-tight text-foreground sm:text-7xl">
                <CountUp value={boxes.length} duration={1.4} />
              </span>
              <span className="text-lg text-muted-foreground">
                {boxes.length === 1 ? "box" : "boxes"}
              </span>
            </div>
          </div>

          {/* CTA: primary box-creation dialog + secondary connect link */}
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
            <CreateBoxDialog />
            <Button variant="outline" size="sm" render={<Link href="/app/connect" />}>
              Connect agent
            </Button>
          </div>
        </div>
      </m.div>

      {/* ── BOX GRID ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {boxes.map((box) => (
          <BoxCard key={box.id} box={box} nowMs={nowMs} />
        ))}

        {/* Create-new-box tile — dashed cell wrapping the canonical dialog */}
        <m.div variants={cardVariants} className="h-full">
          <div
            className={cn(
              "group flex h-full min-h-[160px] flex-col items-center justify-center gap-3 rounded-3xl",
              "border border-dashed border-primary/40 bg-accent/30 p-6 text-center",
              "transition-shadow duration-300 hover:shadow-[0_8px_32px_-4px_rgba(139,92,246,0.15)]"
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">New box</p>
            {/* Reuses the canonical create-box dialog so creation stays a
                single source of truth (auth, slug, audit, template setup). */}
            <CreateBoxDialog />
          </div>
        </m.div>
      </div>
    </m.div>
  );
}
