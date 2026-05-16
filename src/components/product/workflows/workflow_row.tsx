"use client";

import Link from "next/link";
import {
  Archive,
  CircleDot,
  Clock,
  GitFork,
  Pencil,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Workflow } from "@/server/domain/types/workflow";

interface WorkflowRowProps {
  workflow: Workflow;
  latestRunStatus?: "queued" | "running" | "completed" | "failed" | "cancelled" | null;
  latestRunAt?: string | null;
}

export function WorkflowRow({
  workflow,
  latestRunStatus,
  latestRunAt,
}: WorkflowRowProps) {
  const StatusIcon =
    workflow.status === "archived"
      ? Archive
      : workflow.status === "draft"
        ? Pencil
        : CircleDot;

  const nodeCount = workflow.graph?.nodes?.length ?? 0;
  const edgeCount = workflow.graph?.edges?.length ?? 0;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3",
        "transition-[border-color,box-shadow] duration-150 hover:border-strong hover:shadow-sm"
      )}
    >
      <GitFork
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/workflows/${workflow.id}/edit`}
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {workflow.name || "Untitled workflow"}
          </Link>
          <span
            className={cn(
              "inline-flex items-center gap-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
              workflow.status === "active" &&
                "bg-emerald-500/10 text-emerald-600",
              workflow.status === "draft" && "bg-muted text-muted-foreground",
              workflow.status === "archived" && "bg-muted text-muted-foreground"
            )}
          >
            <StatusIcon className="h-2.5 w-2.5" aria-hidden="true" />
            {workflow.status}
          </span>
        </div>
        {workflow.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {workflow.description}
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{nodeCount} nodes</span>
          <span>·</span>
          <span>{edgeCount} edges</span>
          {latestRunAt && (
            <>
              <span>·</span>
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>last run {formatRelative(latestRunAt)}</span>
            </>
          )}
          {latestRunStatus && (
            <span
              className={cn(
                "tabular-nums",
                latestRunStatus === "completed" && "text-emerald-600",
                latestRunStatus === "failed" && "text-rose-600",
                (latestRunStatus === "running" ||
                  latestRunStatus === "queued") &&
                  "text-blue-600"
              )}
            >
              ({latestRunStatus})
            </span>
          )}
        </p>
      </div>
      <Link
        href={`/app/workflows/${workflow.id}/edit`}
        className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
      >
        <Pencil className="mr-1 inline h-3 w-3" aria-hidden="true" />
        Edit
      </Link>
      <Link
        href={`/app/workflows/${workflow.id}/runs`}
        className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
      >
        <Play className="mr-1 inline h-3 w-3" aria-hidden="true" />
        Runs
      </Link>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}
