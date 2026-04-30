"use client";

import Link from "next/link";
import { Globe, Loader2, XCircle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

  const iconClass = cn(
    "h-4 w-4 shrink-0",
    session.status === "active" && "animate-spin text-info",
    session.status === "completed" && "text-success",
    (session.status === "failed" || session.status === "timed_out") &&
      "text-destructive",
    session.status !== "active" &&
      session.status !== "completed" &&
      session.status !== "failed" &&
      session.status !== "timed_out" &&
      "text-muted-foreground"
  );

  return (
    <Link
      href={`/app/web_sessions/${session.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3",
        "transition-colors duration-150 hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      )}
    >
      <Icon className={iconClass} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {session.goal ?? "Browser session"}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {session.page_count} {session.page_count === 1 ? "step" : "steps"}
          </span>
          <span>·</span>
          <span>{elapsedSec}s</span>
          <span>·</span>
          <span className="tabular-nums">
            ${(session.total_cost_cents / 100).toFixed(2)}
          </span>
        </p>
      </div>
      <Badge variant={statusVariant(session.status)} className="shrink-0">
        {session.status}
      </Badge>
    </Link>
  );
}

function statusIcon(status: BrowsingSession["status"]) {
  if (status === "active") return Loader2;
  if (status === "completed") return CheckCircle2;
  if (status === "failed" || status === "timed_out") return XCircle;
  return status === "active" ? Globe : Clock;
}

function statusVariant(
  status: BrowsingSession["status"]
): "info" | "success" | "destructive" | "default" {
  if (status === "active") return "info";
  if (status === "completed") return "success";
  if (status === "failed" || status === "timed_out") return "destructive";
  return "default";
}
