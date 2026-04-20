"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeDate } from "@/lib/format_date";
import {
  computeEstimatedCostCents,
  FALLBACK_MODEL,
} from "@/server/services/workspace_operator_usage_service";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";
import { listMyOperatorRunsAction } from "@/app/app/workspace_operator/history_actions";

/**
 * Server-rendered list of the current user's Operator runs, with a
 * client-side "Load more" button that pages forward via the cursor.
 *
 * Defensive: each row links to /app/workspace_operator/[runId]; the
 * detail page re-checks ownership server-side so a fabricated id in the
 * URL just renders notFound() rather than leaking another user's run.
 */

export interface OperatorHistoryTableProps {
  initialRows: WorkspaceOperatorRunRow[];
  initialCursor: string | null;
  /** ISO string captured on the server render, used by the date helpers
   * to keep server/client output identical during hydration. */
  nowIso: string;
}

export function OperatorHistoryTable({
  initialRows,
  initialCursor,
  nowIso,
}: OperatorHistoryTableProps) {
  const [rows, setRows] = useState<WorkspaceOperatorRunRow[]>(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [error, setError] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const loadMore = useCallback(() => {
    if (!cursor) return;
    setError("");
    startTransition(async () => {
      const res = await listMyOperatorRunsAction({ cursor });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((current) => [...current, ...res.data.rows]);
      setCursor(res.data.nextCursor);
    });
  }, [cursor]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
        <p className="text-sm font-medium text-foreground">
          No Operator runs yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Open the Operator panel from the sidebar to draft your first run.
          Your history will appear here as runs complete.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Prompt</th>
              <th className="px-3 py-2 text-left">Mode</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Duration</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <OperatorHistoryRow key={row.id} row={row} nowIso={nowIso} />
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {cursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={pending}
          >
            {pending ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function OperatorHistoryRow({
  row,
  nowIso,
}: {
  row: WorkspaceOperatorRunRow;
  nowIso: string;
}) {
  const cost = computeEstimatedCostCents(
    row.model ?? FALLBACK_MODEL,
    row.input_tokens ?? 0,
    row.output_tokens ?? 0
  );
  const totalTokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
  return (
    <tr className="border-t border-border hover:bg-muted/20">
      <td className="px-3 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
        {formatRelativeDate(row.created_at, nowIso)}
      </td>
      <td className="px-3 py-2 align-top">
        <Link
          href={`/app/workspace_operator/${row.id}`}
          className="block max-w-[36ch] truncate text-foreground hover:underline"
          title={row.prompt}
        >
          {row.prompt}
        </Link>
      </td>
      <td className="px-3 py-2 align-top">
        <ModeBadge mode={row.mode} />
      </td>
      <td className="px-3 py-2 align-top">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2 align-top text-right text-xs text-muted-foreground whitespace-nowrap">
        {formatDuration(row.duration_ms)}
      </td>
      <td className="px-3 py-2 align-top text-right text-xs text-muted-foreground whitespace-nowrap">
        {totalTokens > 0 ? totalTokens.toLocaleString("en-US") : "—"}
      </td>
      <td className="px-3 py-2 align-top text-right text-xs text-muted-foreground whitespace-nowrap">
        {cost > 0 ? `$${(cost / 100).toFixed(2)}` : "—"}
      </td>
    </tr>
  );
}

function ModeBadge({ mode }: { mode: WorkspaceOperatorRunRow["mode"] }) {
  const variant: "secondary" | "info" | "outline" =
    mode === "plan" ? "info" : mode === "execute" ? "secondary" : "outline";
  return <Badge variant={variant}>{mode}</Badge>;
}

function StatusBadge({
  status,
}: {
  status: WorkspaceOperatorRunRow["status"];
}) {
  // Map status → badge variant — keeps the visual language consistent
  // with the panel's status pills.
  let variant: "default" | "success" | "warning" | "error" | "secondary" | "info" =
    "secondary";
  if (status === "completed") variant = "success";
  else if (status === "failed") variant = "error";
  else if (status === "cancelled") variant = "warning";
  else if (status === "executing" || status === "planning") variant = "info";
  else if (status === "awaiting_approval") variant = "warning";
  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}

function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
