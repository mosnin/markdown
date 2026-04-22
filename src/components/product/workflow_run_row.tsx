"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  Ban,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowRun } from "@/server/domain/types/workflow";

interface WorkflowRunRowProps {
  run: WorkflowRun;
  workflowId: string;
}

export function WorkflowRunRow({ run, workflowId }: WorkflowRunRowProps) {
  const Icon = statusIcon(run.status);
  const elapsed = run.completed_at
    ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    : Date.now() - new Date(run.started_at).getTime();
  const elapsedSec = Math.round(elapsed / 1000);

  return (
    <Link
      href={`/app/workflows/${workflowId}/runs/${run.id}`}
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3",
        "transition-colors hover:border-ring/50 hover:bg-accent/40"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          (run.status === "running" || run.status === "queued") &&
            "animate-spin text-blue-500",
          run.status === "completed" && "text-emerald-500",
          (run.status === "failed" || run.status === "cancelled") &&
            "text-rose-500"
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">
          {new Date(run.started_at).toLocaleString("en-US")}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{elapsedSec}s</span>
          {run.total_cost_cents > 0 && (
            <>
              <span>·</span>
              <span className="tabular-nums">
                ${(run.total_cost_cents / 100).toFixed(2)}
              </span>
            </>
          )}
        </p>
        {run.error && (
          <p className="mt-0.5 truncate text-[11px] text-rose-500">
            {run.error}
          </p>
        )}
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
          run.status === "queued" && "bg-muted text-muted-foreground",
          run.status === "running" && "bg-blue-500/10 text-blue-600",
          run.status === "completed" && "bg-emerald-500/10 text-emerald-600",
          run.status === "failed" && "bg-rose-500/10 text-rose-600",
          run.status === "cancelled" && "bg-muted text-muted-foreground"
        )}
      >
        {run.status}
      </span>
    </Link>
  );
}

function statusIcon(status: WorkflowRun["status"]): LucideIcon {
  switch (status) {
    case "queued":
      return Clock;
    case "running":
      return Loader2;
    case "completed":
      return CheckCircle2;
    case "failed":
      return XCircle;
    case "cancelled":
      return Ban;
  }
}
