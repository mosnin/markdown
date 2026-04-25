"use client";

import Link from "next/link";
import { Globe, Loader2, XCircle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrowsingSession } from "@/server/domain/types/web_tool";

interface WebSessionRowProps {
  session: BrowsingSession;
}

export function WebSessionRow({ session }: WebSessionRowProps) {
  const Icon = statusIcon(session.status);
  const elapsed = session.completed_at
    ? Math.max(
        0,
        new Date(session.completed_at).getTime() -
          new Date(session.started_at).getTime()
      )
    : Date.now() - new Date(session.started_at).getTime();
  const elapsedSec = Math.round(elapsed / 1000);

  return (
    <Link
      href={`/app/web_sessions/${session.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3",
        "transition-colors hover:border-ring/50 hover:bg-accent/40"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          session.status === "active"
            ? "animate-spin text-blue-500"
            : session.status === "completed"
              ? "text-emerald-500"
              : session.status === "failed" || session.status === "timed_out"
                ? "text-rose-500"
                : "text-muted-foreground"
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {session.goal ?? "Browser session"}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{session.page_count} {session.page_count === 1 ? "step" : "steps"}</span>
          <span>·</span>
          <span>{elapsedSec}s</span>
          <span>·</span>
          <span className="tabular-nums">
            ${(session.total_cost_cents / 100).toFixed(2)}
          </span>
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
          session.status === "active" && "bg-blue-500/10 text-blue-600",
          session.status === "completed" && "bg-emerald-500/10 text-emerald-600",
          (session.status === "failed" || session.status === "timed_out") &&
            "bg-rose-500/10 text-rose-600"
        )}
      >
        {session.status}
      </span>
    </Link>
  );
}

function statusIcon(status: BrowsingSession["status"]) {
  if (status === "active") return Loader2;
  if (status === "completed") return CheckCircle2;
  if (status === "failed" || status === "timed_out") return XCircle;
  return status === "active" ? Globe : Clock;
}
