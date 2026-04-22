"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  SkipForward,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listTriggerRunsAction } from "@/app/app/agents/trigger_runs_actions";
import type {
  AgentTriggerRun,
  AgentTriggerRunStatus,
} from "@/server/domain/types/agent_trigger_run";
import { formatAbsoluteDate, formatRelativeDate } from "@/lib/format_date";

const STATUS_META: Record<
  AgentTriggerRunStatus,
  { icon: React.ElementType; label: string; color: string }
> = {
  running: {
    icon: Clock,
    label: "Running",
    color: "text-amber-600 dark:text-amber-400",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    color: "text-emerald-600 dark:text-emerald-400",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-600 dark:text-red-400",
  },
  skipped: {
    icon: SkipForward,
    label: "Skipped",
    color: "text-muted-foreground",
  },
};

interface TriggerRunsHistoryDialogProps {
  triggerId: string;
  triggerLabel: string;
  open: boolean;
  onClose: () => void;
}

export function TriggerRunsHistoryDialog({
  triggerId,
  triggerLabel,
  open,
  onClose,
}: TriggerRunsHistoryDialogProps) {
  const [runs, setRuns] = useState<AgentTriggerRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    listTriggerRunsAction(triggerId, 50).then((result) => {
      if (result.ok) setRuns(result.data);
      else setError(result.error);
      setLoading(false);
    });
  }, [open, triggerId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Run history
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {triggerLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : error ? (
            <div className="flex items-center gap-1.5 text-sm text-red-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </div>
          ) : runs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No runs yet. This trigger hasn&apos;t fired.
            </div>
          ) : (
            <div className="space-y-1.5">
              {runs.map((run) => {
                const meta = STATUS_META[run.status];
                const Icon = meta.icon;
                return (
                  <div
                    key={run.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <Icon
                      className={cn("mt-0.5 h-4 w-4 shrink-0", meta.color)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn("text-xs font-medium", meta.color)}
                        >
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeDate(
                            run.started_at,
                            new Date().toISOString()
                          )}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">
                        {formatAbsoluteDate(run.started_at)}
                      </p>
                      {run.error && (
                        <p className="mt-1 text-xs text-red-500 line-clamp-2">
                          {run.error}
                        </p>
                      )}
                      {run.skip_reason && (
                        <p className="mt-1 text-xs text-muted-foreground italic">
                          {run.skip_reason}
                        </p>
                      )}
                    </div>
                    {run.workspace_operator_run_id && (
                      <Link
                        href={`/app/workspace_operator/${run.workspace_operator_run_id}`}
                        className="shrink-0 inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                        title="Open operator run"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
