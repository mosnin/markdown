"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Workflow, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { listInvocationsByOperatorRunAction } from "@/app/app/sub_agents/actions";
import type { SubagentInvocation } from "@/server/domain/types/subagent";

interface SubagentFanoutBadgeProps {
  operatorRunId: string;
  /** Poll every 2s while any invocation is still queued/running. Default true. */
  live?: boolean;
}

/**
 * Shown on a Pog conversation run when it invoked sub-agents. Renders a
 * compact fanout widget listing each sub-agent's status so the user can
 * follow the delegation without leaving the conversation view.
 */
export function SubagentFanoutBadge({
  operatorRunId,
  live = true,
}: SubagentFanoutBadgeProps) {
  const [invocations, setInvocations] = useState<SubagentInvocation[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const res = await listInvocationsByOperatorRunAction(operatorRunId);
      if (cancelled) return;
      if (res.ok) setInvocations(res.data);
    }

    refresh();

    if (!live) return;

    const timer = setInterval(() => {
      // Only keep polling if at least one invocation is still in flight.
      const anyActive = invocations.some(
        (i) => i.status === "queued" || i.status === "running"
      );
      if (anyActive) refresh();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [operatorRunId, live, invocations]);

  if (invocations.length === 0) return null;

  const counts = summariseCounts(invocations);

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card/50 px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Workflow className="h-3 w-3" aria-hidden="true" />
        Sub-agents
        <span className="ml-1 opacity-70 tabular-nums">{invocations.length}</span>
      </div>
      <ul className="flex flex-wrap gap-1 list-none">
        {invocations.map((inv) => (
          <li key={inv.id}>
            <Link
              href={`/app/sub_agents/${inv.id}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                "transition-colors hover:bg-accent/40",
                statusClass(inv.status)
              )}
            >
              <StatusIcon status={inv.status} />
              <span className="max-w-[12rem] truncate">
                {truncateTask(inv.task)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {counts.completed > 0 && (
        <p className="text-[10px] tabular-nums text-muted-foreground">
          {counts.completed} done · {counts.running} running · {counts.failed} failed
        </p>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: SubagentInvocation["status"] }) {
  if (status === "running" || status === "queued") {
    return <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />;
  }
  return <XCircle className="h-2.5 w-2.5" aria-hidden="true" />;
}

function statusClass(status: SubagentInvocation["status"]): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/30 text-emerald-700 dark:text-emerald-400";
    case "running":
    case "queued":
      return "border-blue-500/30 text-blue-700 dark:text-blue-400";
    case "failed":
    case "cancelled":
      return "border-rose-500/30 text-rose-700 dark:text-rose-400";
  }
}

function truncateTask(task: string): string {
  return task.length > 48 ? `${task.slice(0, 45)}…` : task;
}

function summariseCounts(invocations: SubagentInvocation[]) {
  return invocations.reduce(
    (acc, i) => {
      if (i.status === "completed") acc.completed++;
      else if (i.status === "running" || i.status === "queued") acc.running++;
      else acc.failed++;
      return acc;
    },
    { completed: 0, running: 0, failed: 0 }
  );
}
