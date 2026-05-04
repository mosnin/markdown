"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRelativeDate } from "@/lib/format_date";
import {
  computeEstimatedCostCents,
  FALLBACK_MODEL,
} from "@/server/services/workspace_operator_usage_service";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";
import {
  listMyOperatorRunsAction,
  type OperatorRunStatusFilter,
} from "@/app/app/workspace_operator/history_actions";

/**
 * Server-rendered list of the current user's Operator runs, with a
 * client-side "Load more" button that pages forward via the cursor.
 *
 * Filter UI (status bucket, date range, search) sits above the table.
 * Filter state lives in URL search params (`status`, `from`, `to`, `q`)
 * so a full refresh preserves the active filter, and back/forward
 * navigation works as expected.
 *
 * Defensive: each row links to /app/workspace_operator/[runId]; the
 * detail page re-checks ownership server-side so a fabricated id in the
 * URL just renders notFound() rather than leaking another user's run.
 */

export interface HistoryFilters {
  status: OperatorRunStatusFilter;
  fromDate: string;
  toDate: string;
  search: string;
}

export interface OperatorHistoryTableProps {
  initialRows: WorkspaceOperatorRunRow[];
  initialCursor: string | null;
  /** ISO string captured on the server render, used by the date helpers
   * to keep server/client output identical during hydration. */
  nowIso: string;
  /** Filters resolved from the URL on the server at first paint. */
  initialFilters: HistoryFilters;
}

const STATUS_BUCKETS: {
  value: OperatorRunStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "running", label: "Running" },
];

function filtersEqual(a: HistoryFilters, b: HistoryFilters): boolean {
  return (
    a.status === b.status &&
    a.fromDate === b.fromDate &&
    a.toDate === b.toDate &&
    a.search === b.search
  );
}

function buildQueryString(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  if (filters.search.trim()) params.set("q", filters.search.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function OperatorHistoryTable({
  initialRows,
  initialCursor,
  nowIso,
  initialFilters,
}: OperatorHistoryTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<WorkspaceOperatorRunRow[]>(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [error, setError] = useState<string>("");
  const [pending, startTransition] = useTransition();

  // Draft filter values — the user types/selects here, and we commit to
  // the URL on "Apply" or when the status dropdown changes.
  const [draft, setDraft] = useState<HistoryFilters>(initialFilters);
  // Last applied filters — used by "Load more" so paging respects the
  // current filter set. Kept in sync with the URL.
  const [applied, setApplied] = useState<HistoryFilters>(initialFilters);

  // If the URL changes externally (back/forward, status pill click, etc.),
  // re-read from the search params and re-fetch with those values.
  useEffect(() => {
    const sp = searchParams;
    const nextApplied: HistoryFilters = {
      status: ((sp.get("status") as OperatorRunStatusFilter | null) ??
        "all") as OperatorRunStatusFilter,
      fromDate: sp.get("from") ?? "",
      toDate: sp.get("to") ?? "",
      search: sp.get("q") ?? "",
    };
    // On the first paint these already match the server render, so we
    // short-circuit to avoid a redundant fetch.
    if (filtersEqual(nextApplied, applied)) return;
    setApplied(nextApplied);
    setDraft(nextApplied);
    setError("");
    startTransition(async () => {
      const res = await listMyOperatorRunsAction({
        cursor: null,
        status: nextApplied.status,
        fromDate: nextApplied.fromDate || undefined,
        toDate: nextApplied.toDate || undefined,
        search: nextApplied.search || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows(res.data.rows);
      setCursor(res.data.nextCursor);
    });
    // We intentionally depend on searchParams identity — the `applied`
    // state is what we compare against, not a dep, to avoid a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const commitFilters = useCallback(
    (next: HistoryFilters) => {
      const qs = buildQueryString(next);
      // replace keeps the "history" intent tidy — every keystroke
      // doesn't deepen the browser history stack.
      router.replace(`/app/workspace_operator${qs}`, { scroll: false });
    },
    [router]
  );

  const onApply = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      commitFilters(draft);
    },
    [commitFilters, draft]
  );

  const onStatusChange = useCallback(
    (value: OperatorRunStatusFilter) => {
      // Status is a single-click interaction — commit immediately.
      const next = { ...draft, status: value };
      setDraft(next);
      commitFilters(next);
    },
    [draft, commitFilters]
  );

  const onClear = useCallback(() => {
    const cleared: HistoryFilters = {
      status: "all",
      fromDate: "",
      toDate: "",
      search: "",
    };
    setDraft(cleared);
    commitFilters(cleared);
  }, [commitFilters]);

  const hasActiveFilters = useMemo(() => {
    return (
      applied.status !== "all" ||
      applied.fromDate !== "" ||
      applied.toDate !== "" ||
      applied.search !== ""
    );
  }, [applied]);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    setError("");
    startTransition(async () => {
      const res = await listMyOperatorRunsAction({
        cursor,
        status: applied.status,
        fromDate: applied.fromDate || undefined,
        toDate: applied.toDate || undefined,
        search: applied.search || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((current) => [...current, ...res.data.rows]);
      setCursor(res.data.nextCursor);
    });
  }, [cursor, applied]);

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        draft={draft}
        setDraft={setDraft}
        onApply={onApply}
        onStatusChange={onStatusChange}
        onClear={onClear}
        hasActiveFilters={hasActiveFilters}
        pending={pending}
      />

      {rows.length === 0 ? (
        <EmptyState hasActiveFilters={hasActiveFilters} />
      ) : (
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
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {cursor && rows.length > 0 && (
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

function EmptyState({ hasActiveFilters }: { hasActiveFilters: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {hasActiveFilters ? "No runs match your filters" : "No Pog runs yet"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {hasActiveFilters
          ? "Try clearing the filter or broadening the date range."
          : 'Click "New run" above (or press Cmd/Ctrl+K → "Run Pog Agent") to draft your first run. Your history will appear here as runs complete.'}
      </p>
    </div>
  );
}

interface FilterBarProps {
  draft: HistoryFilters;
  setDraft: (next: HistoryFilters) => void;
  onApply: (event?: React.FormEvent) => void;
  onStatusChange: (value: OperatorRunStatusFilter) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  pending: boolean;
}

function FilterBar({
  draft,
  setDraft,
  onApply,
  onStatusChange,
  onClear,
  hasActiveFilters,
  pending,
}: FilterBarProps) {
  return (
    <form
      onSubmit={onApply}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3"
      aria-label="Filter Operator run history"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <select
            value={draft.status}
            onChange={(e) =>
              onStatusChange(e.target.value as OperatorRunStatusFilter)
            }
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Filter by run status"
            disabled={pending}
          >
            {STATUS_BUCKETS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">From</span>
          <Input
            type="date"
            value={draft.fromDate ? draft.fromDate.slice(0, 10) : ""}
            onChange={(e) => {
              // Normalize a bare date to an ISO timestamp at start of day UTC
              // so the server-side filter compares consistently.
              const v = e.target.value;
              setDraft({
                ...draft,
                fromDate: v ? `${v}T00:00:00.000Z` : "",
              });
            }}
            className="h-9 w-[11rem]"
            aria-label="Filter runs created on or after"
            disabled={pending}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">To</span>
          <Input
            type="date"
            value={draft.toDate ? draft.toDate.slice(0, 10) : ""}
            onChange={(e) => {
              const v = e.target.value;
              setDraft({
                ...draft,
                toDate: v ? `${v}T23:59:59.999Z` : "",
              });
            }}
            className="h-9 w-[11rem]"
            aria-label="Filter runs created on or before"
            disabled={pending}
          />
        </label>

        <label className="flex flex-1 flex-col gap-1 min-w-[12rem]">
          <span className="text-xs font-medium text-muted-foreground">
            Search prompt
          </span>
          <Input
            type="search"
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            placeholder="e.g. roadmap"
            className="h-9"
            aria-label="Search prompt text"
            disabled={pending}
          />
        </label>

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Filtering..." : "Apply"}
          </Button>
          {hasActiveFilters && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onClear}
              disabled={pending}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </form>
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
  let variant: "default" | "success" | "warning" | "destructive" | "secondary" | "info" =
    "secondary";
  if (status === "completed") variant = "success";
  else if (status === "failed") variant = "destructive";
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
