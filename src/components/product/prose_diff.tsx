"use client";

import { useMemo, useState, useEffect } from "react";
import { diffWords, diffLines } from "diff";
import type { Change } from "diff";
import { cn } from "@/lib/utils";
import { computeDiffViaWorker, type DiffResult } from "@/lib/diff_worker_client";

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

// ─── Worker result normalizer ───────────────────────────────────────────────

function workerResultToLocal(result: DiffResult): {
  parts: DiffPart[];
  isLineFallback: boolean;
} {
  return {
    parts: result.parts.map((p) => ({
      value: p.value,
      added: p.added ?? false,
      removed: p.removed ?? false,
    })),
    isLineFallback: result.fallback,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ProseDiffProps {
  before: string | null;
  after: string | null;
  mode?: "unified" | "side_by_side";
}

export function ProseDiff({ before, after, mode = "unified" }: ProseDiffProps) {
  // Show local result immediately (optimistic)
  const localResult = useMemo(
    () => computeDiff(before, after),
    [before, after],
  );

  const [workerResult, setWorkerResult] = useState<{
    parts: DiffPart[];
    isLineFallback: boolean;
  } | null>(null);

  // Try worker in the background; replace local result if it arrives
  useEffect(() => {
    let cancelled = false;
    setWorkerResult(null);

    computeDiffViaWorker(before, after).then((result) => {
      if (!cancelled && result) {
        setWorkerResult(workerResultToLocal(result));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [before, after]);

  const { parts, isLineFallback } = workerResult ?? localResult;

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

// ─── Key helpers ───────────────────────────────────────────────────────────

/**
 * Build a stable content-hash-like key for a diff part: combines the change
 * type, a short content slice, and the cumulative character offset so that
 * identical-valued parts at different positions keep unique, stable keys.
 */
function partType(part: DiffPart): "add" | "del" | "eq" {
  if (part.added) return "add";
  if (part.removed) return "del";
  return "eq";
}

function diffPartKey(part: DiffPart, offset: number): string {
  return `${partType(part)}-${part.value.slice(0, 20)}-${offset}`;
}

// ─── Unified diff view ─────────────────────────────────────────────────────

function UnifiedDiff({
  parts,
  isLineFallback,
}: {
  parts: DiffPart[];
  isLineFallback: boolean;
}) {
  let offset = 0;
  return (
    <div>
      {isLineFallback && (
        <p className="mb-1 text-[10px] text-muted-foreground italic">
          Large content — showing line-level diff.
        </p>
      )}
      <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {parts.map((part) => {
          const key = diffPartKey(part, offset);
          offset += part.value.length;
          if (part.added) {
            return (
              <span
                key={key}
                className="bg-green-100 dark:bg-green-900/30"
              >
                {part.value}
              </span>
            );
          }
          if (part.removed) {
            return (
              <span
                key={key}
                className="bg-red-100 dark:bg-red-900/30 line-through"
              >
                {part.value}
              </span>
            );
          }
          return <span key={key}>{part.value}</span>;
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
            {(() => {
              let leftOffset = 0;
              return leftParts.map((part) => {
                const key = diffPartKey(part, leftOffset);
                leftOffset += part.value.length;
                if (part.removed) {
                  return (
                    <span
                      key={key}
                      className="bg-red-100 dark:bg-red-900/30 line-through"
                    >
                      {part.value}
                    </span>
                  );
                }
                return <span key={key}>{part.value}</span>;
              });
            })()}
          </div>
        </div>
        <div className="px-4 py-3 bg-accent/20">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Branch
          </p>
          <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {(() => {
              let rightOffset = 0;
              return rightParts.map((part) => {
                const key = diffPartKey(part, rightOffset);
                rightOffset += part.value.length;
                if (part.added) {
                  return (
                    <span
                      key={key}
                      className="bg-green-100 dark:bg-green-900/30"
                    >
                      {part.value}
                    </span>
                  );
                }
                return <span key={key}>{part.value}</span>;
              });
            })()}
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
