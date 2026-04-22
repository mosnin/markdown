"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTriggerRunSummaryAction } from "@/app/app/agents/trigger_runs_actions";
import type { TriggerRunSummary } from "@/app/app/agents/trigger_runs_actions";
import { formatRelativeDate } from "@/lib/format_date";

interface TriggerRunsSummaryBadgeProps {
  triggerId: string;
  /** Called when the user clicks the badge; opens the history dialog */
  onOpenHistory: () => void;
}

export function TriggerRunsSummaryBadge({
  triggerId,
  onOpenHistory,
}: TriggerRunsSummaryBadgeProps) {
  const [summary, setSummary] = useState<TriggerRunSummary | null>(null);

  useEffect(() => {
    getTriggerRunSummaryAction(triggerId).then((result) => {
      if (result.ok) setSummary(result.data);
    });
  }, [triggerId]);

  if (!summary) return null;

  const { total, succeeded, failed, lastRun } = summary;
  const successRate = total > 0 ? Math.round((succeeded / total) * 100) : null;
  const healthColor =
    successRate === null
      ? "text-muted-foreground"
      : successRate >= 90
        ? "text-emerald-600 dark:text-emerald-400"
        : successRate >= 60
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";

  return (
    <button
      onClick={onOpenHistory}
      className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/50 transition-colors"
    >
      {total === 0 ? (
        <span>No runs yet</span>
      ) : (
        <>
          <span className={cn("font-medium", healthColor)}>
            {successRate}% healthy
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span className="flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            {succeeded}
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-0.5">
              <XCircle className="h-3 w-3 text-red-500" />
              {failed}
            </span>
          )}
          {lastRun && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <Clock className="h-3 w-3" />
              <span>
                {formatRelativeDate(
                  lastRun.started_at,
                  new Date().toISOString()
                )}
              </span>
            </>
          )}
        </>
      )}
    </button>
  );
}
