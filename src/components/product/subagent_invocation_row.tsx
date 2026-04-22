"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubagentInvocation } from "@/server/domain/types/subagent";

interface SubagentInvocationRowProps {
  invocation: SubagentInvocation;
  skillName?: string | null;
}

export function SubagentInvocationRow({
  invocation,
  skillName,
}: SubagentInvocationRowProps) {
  const Icon = statusIcon(invocation.status);
  const elapsed = invocation.completed_at
    ? new Date(invocation.completed_at).getTime() -
      new Date(invocation.started_at).getTime()
    : Date.now() - new Date(invocation.started_at).getTime();
  const elapsedSec = Math.round(elapsed / 1000);

  const totalTokens = invocation.input_tokens + invocation.output_tokens;

  return (
    <Link
      href={`/app/sub_agents/${invocation.id}`}
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3",
        "transition-colors hover:border-ring/50 hover:bg-accent/40"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          invocation.status === "running" && "animate-spin text-blue-500",
          invocation.status === "queued" && "text-muted-foreground",
          invocation.status === "completed" && "text-emerald-500",
          (invocation.status === "failed" ||
            invocation.status === "cancelled") &&
            "text-rose-500"
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {skillName && (
            <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              {skillName}
            </span>
          )}
          <p className="truncate text-sm text-foreground">{invocation.task}</p>
        </div>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{elapsedSec}s</span>
          <span>·</span>
          <span>{invocation.tool_calls_count} {invocation.tool_calls_count === 1 ? "tool call" : "tool calls"}</span>
          <span>·</span>
          <span className="tabular-nums">
            {totalTokens.toLocaleString()} tokens
          </span>
          {invocation.depth > 1 && (
            <>
              <span>·</span>
              <span>depth {invocation.depth}</span>
            </>
          )}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
          invocation.status === "queued" && "bg-muted text-muted-foreground",
          invocation.status === "running" && "bg-blue-500/10 text-blue-600",
          invocation.status === "completed" && "bg-emerald-500/10 text-emerald-600",
          invocation.status === "failed" && "bg-rose-500/10 text-rose-600",
          invocation.status === "cancelled" && "bg-muted text-muted-foreground"
        )}
      >
        {invocation.status}
      </span>
    </Link>
  );
}

function statusIcon(status: SubagentInvocation["status"]) {
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
