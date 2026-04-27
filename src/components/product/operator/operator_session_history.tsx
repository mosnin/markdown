"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronRight,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listSessionRunsAction } from "@/app/app/workspace_operator/sessions_actions";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface OperatorSessionHistoryProps {
  sessionId: string;
  activeRunId?: string | null;
  /** Refreshed after a new run starts so the new run appears. */
  refreshKey?: number;
  onSelectRun?: (runId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OperatorSessionHistory({
  sessionId,
  activeRunId,
  refreshKey = 0,
  onSelectRun,
}: OperatorSessionHistoryProps) {
  const [runs, setRuns] = useState<WorkspaceOperatorRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSessionRunsAction(sessionId, 20).then((res) => {
      if (cancelled) return;
      if (res.ok) setRuns(res.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No runs in this session yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {runs.map((run) => (
        <RunHistoryRow
          key={run.id}
          run={run}
          isActive={run.id === activeRunId}
          onSelect={onSelectRun ? () => onSelectRun(run.id) : undefined}
        />
      ))}
    </div>
  );
}

// ─── RunHistoryRow ────────────────────────────────────────────────────────────

function RunHistoryRow({
  run,
  isActive,
  onSelect,
}: {
  run: WorkspaceOperatorRunRow;
  isActive: boolean;
  onSelect?: () => void;
}) {
  const isTerminal =
    run.status === "completed" || run.status === "failed" || run.status === "cancelled";

  const statusIcon = () => {
    switch (run.status) {
      case "completed":
        return <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" aria-label="Completed" />;
      case "failed":
        return <XCircle className="h-3 w-3 text-destructive shrink-0" aria-label="Failed" />;
      case "cancelled":
        return <Ban className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Cancelled" />;
      case "executing":
      case "planning":
        return <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" aria-label="Running" />;
      default:
        return <Clock className="h-3 w-3 text-muted-foreground shrink-0" aria-label={run.status} />;
    }
  };

  const timeAgo = relativeTime(run.created_at);
  const truncatedPrompt = run.prompt.length > 80
    ? run.prompt.slice(0, 80) + "…"
    : run.prompt;

  const inner = (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2 text-xs transition-colors",
        isTerminal
          ? "cursor-pointer hover:bg-accent"
          : "cursor-default",
        isActive && "bg-accent"
      )}
      onClick={onSelect}
    >
      <div className="mt-0.5">{statusIcon()}</div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate leading-snug", isActive ? "font-medium text-foreground" : "text-foreground/80")}>
          {truncatedPrompt}
        </p>
        <p className="text-[10px] text-muted-foreground/60">{timeAgo}</p>
      </div>
      {isTerminal && (
        <Link
          href={`/app/workspace_operator/${run.id}`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          aria-label="View run detail"
        >
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );

  return inner;
}
