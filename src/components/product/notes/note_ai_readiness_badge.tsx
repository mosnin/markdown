"use client";

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AI Readiness Score Badge
 *
 * Scores 0-100 based on how well a note is set up for AI context retrieval:
 *   - Has summary (non-empty): 20 pts
 *   - Has 2+ tags: 20 pts
 *   - Has 2+ links: 20 pts
 *   - read_hint is set: 20 pts
 *   - retrieval_priority > 0: 20 pts
 *
 * Color tiers:
 *   80-100 → green
 *   50-79  → amber
 *   0-49   → slate
 */

interface NoteAiReadinessBadgeProps {
  summary: string | null;
  tags: string[];
  linkCount: number;
  readHint: string | null;
  retrievalPriority: number;
  className?: string;
}

interface ReadinessBreakdown {
  hasSummary: boolean;
  hasTags: boolean;
  hasLinks: boolean;
  hasReadHint: boolean;
  hasRetrievalPriority: boolean;
  score: number;
}

function computeReadiness(props: Omit<NoteAiReadinessBadgeProps, "className">): ReadinessBreakdown {
  const hasSummary = !!(props.summary && props.summary.trim().length > 0);
  const hasTags = props.tags.length >= 2;
  const hasLinks = props.linkCount >= 2;
  const hasReadHint = !!props.readHint;
  const hasRetrievalPriority = props.retrievalPriority > 0;

  const score =
    (hasSummary ? 20 : 0) +
    (hasTags ? 20 : 0) +
    (hasLinks ? 20 : 0) +
    (hasReadHint ? 20 : 0) +
    (hasRetrievalPriority ? 20 : 0);

  return { hasSummary, hasTags, hasLinks, hasReadHint, hasRetrievalPriority, score };
}

export function NoteAiReadinessBadge({
  summary,
  tags,
  linkCount,
  readHint,
  retrievalPriority,
  className,
}: NoteAiReadinessBadgeProps) {
  const breakdown = computeReadiness({ summary, tags, linkCount, readHint, retrievalPriority });
  const { score } = breakdown;

  const colorClass =
    score >= 80
      ? "text-green-400 border-green-500/30 bg-green-500/10"
      : score >= 50
      ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
      : "text-slate-400 border-slate-500/30 bg-slate-500/10";

  const tooltipLines = [
    `AI Readiness: ${score}/100`,
    "",
    `${breakdown.hasSummary ? "✓" : "✗"} Summary (20 pts)`,
    `${breakdown.hasTags ? "✓" : "✗"} 2+ tags (20 pts)`,
    `${breakdown.hasLinks ? "✓" : "✗"} 2+ links (20 pts)`,
    `${breakdown.hasReadHint ? "✓" : "✗"} Read hint set (20 pts)`,
    `${breakdown.hasRetrievalPriority ? "✓" : "✗"} Retrieval priority > 0 (20 pts)`,
  ].join("\n");

  return (
    <span
      title={tooltipLines}
      aria-label={`AI readiness score: ${score} out of 100`}
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
