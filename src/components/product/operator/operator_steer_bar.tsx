"use client";

import Link from "next/link";
import { Maximize2, Play, RotateCcw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OperatorRunPhase } from "@/app/app/workspace_operator/types";

// ---------------------------------------------------------------------------
// Operator steer bar — the row of run-control affordances.
//
// Surfaces the right action for the current phase:
//
//   - awaiting_approval → Approve & run, Cancel, Open full view
//   - executing         → Cancel run, Open full view
//   - failed            → Retry, Start over
//   - completed         → Run again
//   - cancelled         → Start over
//   - quota_exceeded / idle / planning → no chrome (the transcript view owns
//     the primary action in those phases — pricing nudge, spinner, etc.)
//
// Mounted under the transcript by the orchestrator on `mode="page"`. On
// the sheet variant the transcript still owns these buttons inline so the
// affordances stay close to the live event tail.
// ---------------------------------------------------------------------------

export interface OperatorSteerBarProps {
  phase: OperatorRunPhase;
  runId: string | null;
  isExecPending: boolean;
  cancelling: boolean;
  retrying: boolean;
  hasSteps: boolean;
  onApproveAndRun: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onReset: () => void;
}

export function OperatorSteerBar({
  phase,
  runId,
  isExecPending,
  cancelling,
  retrying,
  hasSteps,
  onApproveAndRun,
  onCancel,
  onRetry,
  onReset,
}: OperatorSteerBarProps) {
  if (
    phase === "idle" ||
    phase === "planning" ||
    phase === "quota_exceeded" ||
    phase === "completed" ||
    phase === "failed" ||
    phase === "cancelled"
  ) {
    // Terminal / pre-run phases have their CTAs inside the transcript card.
    return null;
  }

  return (
    <div
      role="toolbar"
      aria-label="Run controls"
      className="flex flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3"
    >
      {phase === "awaiting_approval" && (
        <>
          <Button onClick={onApproveAndRun} disabled={isExecPending || !hasSteps}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Approve next step
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={cancelling}>
            <Square className="h-4 w-4" aria-hidden="true" />
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </>
      )}

      {phase === "executing" && (
        <Button variant="outline" onClick={onCancel} disabled={cancelling}>
          <Square className="h-4 w-4" aria-hidden="true" />
          {cancelling ? "Cancelling…" : "Cancel run"}
        </Button>
      )}

      <span className="flex-1" aria-hidden="true" />

      {runId && (
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/app/workspace_operator/live/${runId}`} />}
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
          Open full view
        </Button>
      )}

      {/* Retry/reset only show as quiet trailing affordances when relevant. */}
      {phase === "executing" && retrying && (
        <Button variant="ghost" size="sm" onClick={onRetry} disabled>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Retrying…
        </Button>
      )}
      {phase === "awaiting_approval" && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          Discard plan
        </Button>
      )}
    </div>
  );
}
