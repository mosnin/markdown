"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, GitBranch, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { discardBranchAction } from "@/app/app/branches/actions";
import { dismissStaleWarningAction, runCleanupNowAction } from "./actions";

interface StaleRow {
  id: string;
  name: string;
  description: string | null;
  daysIdle: number;
  warningCount: number;
  lastWarnedAt: string | null;
}

/**
 * Stale-branch list panel.
 *
 * Per-row actions:
 *   - "Dismiss warning" — clears the warning (calls
 *     {@link dismissStaleWarningAction}).
 *   - "Discard now" — canonical discard flow (same action the branches
 *     list calls; safe to reuse here).
 *
 * Bulk:
 *   - "Run cleanup now" (admins only) — warns + auto-discards once
 *     synchronously against this workspace.
 */
export function StaleBranchesPanel({
  initialRows,
  warnAfterIdleDays,
  autoDiscardAfterDays,
  canRunCleanup,
}: {
  initialRows: StaleRow[];
  warnAfterIdleDays: number;
  autoDiscardAfterDays: number;
  canRunCleanup: boolean;
}) {
  const [rows, setRows] = useState<StaleRow[]>(initialRows);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function dismiss(id: string) {
    startTransition(async () => {
      const res = await dismissStaleWarningAction(id);
      if (res.ok) {
        setRows((r) => r.filter((b) => b.id !== id));
        setToast({ kind: "ok", text: "Warning dismissed." });
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  function discard(id: string) {
    if (!confirm("Discard this branch? Heads and branch-local rows are removed.")) return;
    startTransition(async () => {
      const res = await discardBranchAction(id);
      if (res.ok) {
        setRows((r) => r.filter((b) => b.id !== id));
        setToast({ kind: "ok", text: "Branch discarded." });
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  function runCleanup() {
    startTransition(async () => {
      const res = await runCleanupNowAction();
      if (res.ok) {
        setToast({
          kind: "ok",
          text: `Cleanup run — warned ${res.data.warned}, discarded ${res.data.discarded}.`,
        });
        window.location.reload();
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">
              Stale open branches
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Branches idle more than {warnAfterIdleDays} day
              {warnAfterIdleDays === 1 ? "" : "s"}. Auto-discard triggers at{" "}
              {autoDiscardAfterDays} day
              {autoDiscardAfterDays === 1 ? "" : "s"} after at least one warning.
            </CardDescription>
          </div>
          {canRunCleanup && (
            <Button
              size="sm"
              variant="outline"
              onClick={runCleanup}
              disabled={pending}
              className="shrink-0"
            >
              <Play className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Run cleanup now
            </Button>
          )}
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-5">
        {toast && (
          <div
            className={cn(
              "mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
              toast.kind === "ok"
                ? "border-border bg-accent/40"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            )}
            role={toast.kind === "ok" ? "status" : "alert"}
          >
            <p className="flex-1">{toast.text}</p>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
            No stale branches — good hygiene.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 list-none">
            {rows.map((b) => (
              <li key={b.id}>
                <StaleRowCard
                  row={b}
                  warnAfterIdleDays={warnAfterIdleDays}
                  autoDiscardAfterDays={autoDiscardAfterDays}
                  pending={pending}
                  onDismiss={() => dismiss(b.id)}
                  onDiscard={() => discard(b.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StaleRowCard({
  row,
  warnAfterIdleDays,
  autoDiscardAfterDays,
  pending,
  onDismiss,
  onDiscard,
}: {
  row: StaleRow;
  warnAfterIdleDays: number;
  autoDiscardAfterDays: number;
  pending: boolean;
  onDismiss: () => void;
  onDiscard: () => void;
}) {
  const daysUntilAutoDiscard = Math.max(0, autoDiscardAfterDays - row.daysIdle);
  const pastWarnThreshold = row.daysIdle >= warnAfterIdleDays;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/branches/${row.id}`}
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {row.name}
          </Link>
          {pastWarnThreshold && (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 text-[10px] font-normal border-warning/40 text-warning"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {row.warningCount > 0 ? `Warned ${row.warningCount}x` : "Stale"}
            </Badge>
          )}
        </div>
        {row.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {row.description}
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          Idle {row.daysIdle} day{row.daysIdle === 1 ? "" : "s"}
          {row.warningCount > 0 && (
            <>
              {" · "}Auto-discards in {daysUntilAutoDiscard} day
              {daysUntilAutoDiscard === 1 ? "" : "s"}
            </>
          )}
          {row.lastWarnedAt && (
            <>
              {" · "}Last warned{" "}
              {new Date(row.lastWarnedAt).toLocaleDateString()}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onDismiss}
          disabled={pending}
          className="text-xs"
          title="Clear the warning and mark this branch active"
        >
          Dismiss
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={pending}
          aria-label={`Discard ${row.name}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
