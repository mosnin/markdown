"use client";

import { useEffect, useState } from "react";
import { Globe, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getWebBudgetStatusAction } from "@/app/app/web_sessions/actions";
import type { WebBudgetStatus } from "@/app/app/web_sessions/actions";

export function WebBudgetCard() {
  const [status, setStatus] = useState<WebBudgetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWebBudgetStatusAction().then((res) => {
      if (res.ok) setStatus(res.data);
      else setError(res.error);
    });
  }, []);

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {error}
      </p>
    );
  }

  if (!status) {
    return (
      <div className="h-10 animate-pulse rounded-md bg-muted/40" />
    );
  }

  const exhausted = status.percent_used >= 100;
  const warning = status.percent_used >= 80;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          This month
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">
          ${(status.current_cents / 100).toFixed(2)}
          <span className="mx-1 opacity-40">/</span>
          ${(status.budget_cents / 100).toFixed(2)}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={status.percent_used}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full transition-all duration-300",
            exhausted
              ? "bg-destructive"
              : warning
                ? "bg-warning"
                : "bg-success"
          )}
          style={{ width: `${Math.min(100, status.percent_used)}%` }}
        />
      </div>
      {exhausted && (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Budget exhausted. Agents cannot call web tools until next month or
          budget is raised.
        </p>
      )}
    </div>
  );
}
