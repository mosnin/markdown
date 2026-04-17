"use client";

import { useMemo, useState } from "react";
import { diffWords, diffLines } from "diff";
import type { Change } from "diff";
import { cn } from "@/lib/utils";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Threshold (bytes) above which we fall back to line-level diff. */
const LARGE_CONTENT_THRESHOLD = 50_000;

// ─── Pure diff computation ──────────────────────────────────────────────────

export interface DiffPart {
  value: string;
  added: boolean;
  removed: boolean;
}

/**
 * Compute a word-level or line-level diff between `before` and `after`.
 *
 * Returns an array of change parts and a flag indicating whether it
 * fell back to line-level diff due to content size.
 */
export function computeDiff(
  before: string | null,
  after: string | null,
): { parts: DiffPart[]; isLineFallback: boolean } {
  if (before === null && after === null) {
    return { parts: [], isLineFallback: false };
  }

  if (before === null) {
    return {
      parts: [{ value: after!, added: true, removed: false }],
      isLineFallback: false,
    };
  }

  if (after === null) {
    return {
      parts: [{ value: before, added: false, removed: true }],
      isLineFallback: false,
    };
  }

  const totalSize = before.length + after.length;
  const isLineFallback = totalSize > LARGE_CONTENT_THRESHOLD;

  const changes: Change[] = isLineFallback
    ? diffLines(before, after)
    : diffWords(before, after);

  const parts: DiffPart[] = changes.map((c) => ({
    value: c.value,
    added: c.added ?? false,
    removed: c.removed ?? false,
  }));

  return { parts, isLineFallback };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ProseDiffProps {
  before: string | null;
  after: string | null;
  mode?: "unified" | "side_by_side";
}

export function ProseDiff({ before, after, mode = "unified" }: ProseDiffProps) {
  const { parts, isLineFallback } = useMemo(
    () => computeDiff(before, after),
    [before, after],
  );

  if (parts.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
        No content.
      </p>
    );
  }

  if (mode === "side_by_side") {
    return (
      <SideBySideDiff parts={parts} isLineFallback={isLineFallback} />
    );
  }

  return <UnifiedDiff parts={parts} isLineFallback={isLineFallback} />;
}

// ─── Unified diff view ─────────────────────────────────────────────────────

function UnifiedDiff({
  parts,
  isLineFallback,
}: {
  parts: DiffPart[];
  isLineFallback: boolean;
}) {
  return (
    <div>
      {isLineFallback && (
        <p className="mb-1 text-[10px] text-muted-foreground italic">
          Large content — showing line-level diff.
        </p>
      )}
      <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {parts.map((part, i) => {
          if (part.added) {
            return (
              <span
                key={i}
                className="bg-green-100 dark:bg-green-900/30"
              >
                {part.value}
              </span>
            );
          }
          if (part.removed) {
            return (
              <span
                key={i}
                className="bg-red-100 dark:bg-red-900/30 line-through"
              >
                {part.value}
              </span>
            );
          }
          return <span key={i}>{part.value}</span>;
        })}
      </div>
    </div>
  );
}

// ─── Side-by-side diff view ────────────────────────────────────────────────

function SideBySideDiff({
  parts,
  isLineFallback,
}: {
  parts: DiffPart[];
  isLineFallback: boolean;
}) {
  // Left column: removed + unchanged; Right column: added + unchanged
  const leftParts = parts.filter((p) => !p.added);
  const rightParts = parts.filter((p) => !p.removed);

  return (
    <div>
      {isLineFallback && (
        <p className="mb-1 text-[10px] text-muted-foreground italic">
          Large content — showing line-level diff.
        </p>
      )}
      <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:divide-x md:divide-border">
        <div className="px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Main
          </p>
          <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {leftParts.map((part, i) => {
              if (part.removed) {
                return (
                  <span
                    key={i}
                    className="bg-red-100 dark:bg-red-900/30 line-through"
                  >
                    {part.value}
                  </span>
                );
              }
              return <span key={i}>{part.value}</span>;
            })}
          </div>
        </div>
        <div className="px-4 py-3 bg-accent/20">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Branch
          </p>
          <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {rightParts.map((part, i) => {
              if (part.added) {
                return (
                  <span
                    key={i}
                    className="bg-green-100 dark:bg-green-900/30"
                  >
                    {part.value}
                  </span>
                );
              }
              return <span key={i}>{part.value}</span>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Diff view mode toggle ─────────────────────────────────────────────────

export type DiffViewMode = "unified" | "side_by_side";

export function DiffViewToggle({
  mode,
  onChange,
}: {
  mode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border text-[10px]">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange("unified"); }}
        className={cn(
          "px-2 py-0.5 transition-colors",
          mode === "unified"
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Unified
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange("side_by_side"); }}
        className={cn(
          "px-2 py-0.5 transition-colors border-l border-border",
          mode === "side_by_side"
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Side-by-side
      </button>
    </div>
  );
}
