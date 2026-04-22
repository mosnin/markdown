"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText, CheckCircle, Lightbulb, HelpCircle, Zap, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Insight, InsightCategory } from "@/server/domain/types/insight";

const CATEGORY_META: Record<InsightCategory, { icon: React.ElementType; label: string; color: string }> = {
  fact:     { icon: FileText,    label: "Fact",     color: "text-blue-600 bg-blue-500/10 border-blue-500/30" },
  decision: { icon: CheckCircle, label: "Decision", color: "text-indigo-600 bg-indigo-500/10 border-indigo-500/30" },
  insight:  { icon: Lightbulb,   label: "Insight",  color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
  question: { icon: HelpCircle,  label: "Question", color: "text-violet-600 bg-violet-500/10 border-violet-500/30" },
  action:   { icon: Zap,         label: "Action",   color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
};

const ALL_CATEGORIES: InsightCategory[] = ["fact", "decision", "insight", "question", "action"];

export function InsightsList({ insights }: { insights: Insight[] }) {
  const [activeCategory, setActiveCategory] = useState<InsightCategory | null>(null);

  const filtered = activeCategory ? insights.filter((i) => i.category === activeCategory) : insights;
  const counts = ALL_CATEGORIES.reduce((acc, c) => ({ ...acc, [c]: insights.filter((i) => i.category === c).length }), {} as Record<InsightCategory, number>);

  return (
    <div>
      <div className="border-b border-border bg-background/80 backdrop-blur px-6 py-3 sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mr-1">Category</span>
          {ALL_CATEGORIES.filter((c) => counts[c] > 0).map((c) => {
            const meta = CATEGORY_META[c];
            return (
              <button
                key={c}
                onClick={() => setActiveCategory(activeCategory === c ? null : c)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] transition-colors",
                  activeCategory === c
                    ? meta.color + " border"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border border-transparent"
                )}
              >
                <meta.icon className="h-3 w-3" aria-hidden="true" />
                {meta.label} <span className="text-muted-foreground/60">·{counts[c]}</span>
              </button>
            );
          })}
          {activeCategory && (
            <button onClick={() => setActiveCategory(null)} className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-6 py-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          {filtered.length} insight{filtered.length === 1 ? "" : "s"}
        </p>
        <div className="space-y-2">
          {filtered.map((i) => {
            const meta = CATEGORY_META[i.category];
            return (
              <Link
                key={i.id}
                href={`/app/notes/${i.note_id}`}
                className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start gap-3">
                  <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border", meta.color)}>
                    <meta.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{i.claim}</p>
                    {i.source_excerpt && (
                      <p className="mt-1 text-xs text-muted-foreground italic line-clamp-2">
                        &ldquo;{i.source_excerpt}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
