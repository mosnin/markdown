"use client";

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface NoteAiReadinessBadgeProps {
  summary: string | null;
  tags: string[];
  linkCount: number;
  readHint: string | null;
  retrievalPriority: number;
  className?: string;
}

/**
 * Compact badge showing the note's AI readiness score (0–100).
 *
 * Scoring (each criterion = 20 pts):
 *   1. Summary written
 *   2. At least 2 tags
 *   3. At least 2 semantic links
 *   4. Read hint set
 *   5. Retrieval priority > 0
 *
 * Colour coding:
 *   80–100  green   (well optimised)
 *   50–79   amber   (room to improve)
 *   0–49    slate   (needs attention)
 */
export function NoteAiReadinessBadge({
  summary,
  tags,
  linkCount,
  readHint,
  retrievalPriority,
  className,
}: NoteAiReadinessBadgeProps) {
  const criteria = [
    { label: "Summary written",        done: !!(summary && summary.trim().length > 0) },
    { label: "2+ tags",                done: tags.length >= 2 },
    { label: "2+ semantic links",      done: linkCount >= 2 },
    { label: "Read hint set",          done: !!readHint },
    { label: "Retrieval priority > 0", done: retrievalPriority > 0 },
  ];

  const score = criteria.filter((c) => c.done).length * 20;

  const colorClass =
    score >= 80
      ? "text-green-600 border-green-500/30 bg-green-500/10 dark:text-green-400"
      : score >= 50
        ? "text-amber-600 border-amber-500/30 bg-amber-500/10 dark:text-amber-400"
        : "text-slate-500 border-slate-400/30 bg-slate-500/10 dark:text-slate-400";

  const tooltipLines = [
    `AI Readiness: ${score}/100`,
    "",
    ...criteria.map((c) => `${c.done ? "✓" : "✗"} ${c.label}`),
  ].join("\n");

  return (
    <span
      title={tooltipLines}
      aria-label={`AI readiness score ${score} out of 100`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-default select-none",
        colorClass,
        className
      )}
    >
      <Bot className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      AI: {score}%
    </span>
  );
}
