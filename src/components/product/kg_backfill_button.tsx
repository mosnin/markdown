"use client";

import { useState, useEffect, useTransition } from "react";
import { Network, Loader2, Check, AlertCircle } from "lucide-react";
import {
  startKgBackfillAction,
  getBackfillStatusAction,
} from "@/app/app/settings/knowledge_graph_actions";
import type { KgBackfillJob } from "@/server/domain/types/kg_backfill_job";

export function KgBackfillButton() {
  const [job, setJob] = useState<KgBackfillJob | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Poll every 3 seconds while a job is running
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      const result = await getBackfillStatusAction();
      if (result.ok) setJob(result.data);
    }

    refresh();

    if (job && (job.status === "pending" || job.status === "running")) {
      timer = setInterval(refresh, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [job?.status]);

  const isRunning = job?.status === "pending" || job?.status === "running";

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const result = await startKgBackfillAction();
      if (result.ok) {
        const refreshResult = await getBackfillStatusAction();
        if (refreshResult.ok) setJob(refreshResult.data);
      } else {
        setError(result.error);
      }
    });
  }

  const percent =
    job && job.total_notes > 0
      ? Math.round(
          ((job.processed_notes + job.failed_notes) / job.total_notes) * 100
        )
      : 0;

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleStart}
        disabled={isPending || isRunning}
        className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
      >
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : job?.status === "completed" ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        ) : (
          <Network className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {isRunning
          ? `Extracting… ${job?.processed_notes ?? 0}/${job?.total_notes ?? 0}`
          : job?.status === "completed"
            ? "Re-run extraction for all notes"
            : "Extract entities from all existing notes"}
      </button>

      {isRunning && (
        <div className="h-1.5 w-64 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-violet-500 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {job?.status === "completed" && (
        <p className="text-xs text-muted-foreground">
          Last run processed {job.processed_notes} note
          {job.processed_notes === 1 ? "" : "s"}
          {job.failed_notes > 0 && (
            <span className="text-red-500"> ({job.failed_notes} failed)</span>
          )}
        </p>
      )}

      {error && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
