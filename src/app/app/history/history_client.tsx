"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  ChevronRight,
  Download,
  FolderTree,
  PackageOpen,
  RotateCcw,
  Undo2,
  User as UserIcon,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getChangeSetDetailAction,
  restoreChangeSetAction,
} from "./actions";
import type {
  ChangeSet,
  ChangeSetItem,
  StructuralEvent,
} from "@/server/services/change_set_service";
import type { RestorePlan } from "@/server/services/restore_service";

/**
 * History list + detail + restore UI.
 *
 * This is the first product surface that reads from the rollback
 * foundation (change_sets / change_set_items / structural_events).
 * The UI is deliberately modest — rows, a detail drawer, a confirm
 * dialog for the restore — but every element is wired to the same
 * services a future richer surface would use.
 */

const originIcons: Record<
  ChangeSet["origin"],
  { Icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  manual_edit:       { Icon: Wand2,      label: "Manual edit" },
  import:            { Icon: Download,   label: "Import" },
  proposal_approval: { Icon: CheckCircle2, label: "Proposal approval" },
  structural_move:   { Icon: ArrowDownUp, label: "Move" },
  lifecycle:         { Icon: FolderTree, label: "Lifecycle" },
  rollback:          { Icon: RotateCcw,  label: "Rollback" },
  restore:           { Icon: Undo2,      label: "Restore" },
  branch_promotion:  { Icon: PackageOpen, label: "Branch promotion" },
  system:            { Icon: UserIcon,   label: "System" },
};

export function HistoryClient({
  initialRows,
  canRestore,
}: {
  initialRows: ChangeSet[];
  canRestore: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    changeSet: ChangeSet;
    items: ChangeSetItem[];
    structural: StructuralEvent[];
    plan: RestorePlan;
  } | null>(null);
  const [detailLoading, startDetailLoad] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [restoring, startRestore] = useTransition();

  function openDetail(id: string) {
    setDetailId(id);
    setDetail(null);
    startDetailLoad(async () => {
      const res = await getChangeSetDetailAction(id);
      if (res.ok) setDetail(res.data);
    });
  }

  function closeDetail() {
    setDetailId(null);
    setDetail(null);
  }

  function confirmRestore(id: string) {
    setConfirmingId(id);
  }

  function runRestore() {
    if (!confirmingId) return;
    const id = confirmingId;
    startRestore(async () => {
      const res = await restoreChangeSetAction(id);
      setConfirmingId(null);
      if (res.ok && res.data) {
        setRestoreResult({
          id,
          ok: res.data.ok,
          message: res.data.ok
            ? "Changes reverted. A new restore entry has been added to history."
            : res.data.error ?? "Restore failed",
        });
      } else {
        setRestoreResult({
          id,
          ok: false,
          message: res.ok ? "Unknown error" : res.error,
        });
      }
      // Refresh list so the new restore change set appears at the top.
      const { listHistoryAction } = await import("./actions");
      const fresh = await listHistoryAction({ limit: 100 });
      if (fresh.ok) setRows(fresh.data);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center">
        <Undo2 className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No history yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Imports, approvals, moves, and edits will appear here as soon as
          they happen. Each entry can be undone as one operation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {restoreResult && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
            restoreResult.ok
              ? "border-border bg-card"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          )}
          role={restoreResult.ok ? "status" : "alert"}
        >
          {restoreResult.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="flex-1">{restoreResult.message}</p>
          <button
            onClick={() => setRestoreResult(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-2 list-none">
        {rows.map((row) => (
          <li key={row.id}>
            <HistoryRow
              row={row}
              active={detailId === row.id}
              onOpen={() => openDetail(row.id)}
              onRestore={canRestore ? () => confirmRestore(row.id) : undefined}
            />
          </li>
        ))}
      </ul>

      {/* Detail drawer as a Dialog — clean and keyboard-accessible */}
      <Dialog open={!!detailId} onOpenChange={(v) => !v && closeDetail()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Change set detail</DialogTitle>
          </DialogHeader>
          {detailLoading || !detail ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <DetailBody
              items={detail.items}
              structural={detail.structural}
              plan={detail.plan}
            />
          )}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {/* Confirm restore dialog */}
      <Dialog open={!!confirmingId} onOpenChange={(v) => !v && setConfirmingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo this change?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will revert every object touched by this change set. A new
            entry will be added to history recording the undo. The original
            change set stays in history — nothing is deleted.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingId(null)}
              disabled={restoring}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={runRestore} disabled={restoring}>
              {restoring ? "Reverting…" : "Undo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryRow({
  row,
  active,
  onOpen,
  onRestore,
}: {
  row: ChangeSet;
  active: boolean;
  onOpen: () => void;
  onRestore?: () => void;
}) {
  const meta = originIcons[row.origin] ?? originIcons.system;
  const Icon = meta.Icon;
  const time = new Date(row.created_at).toLocaleString();

  const statusBadge =
    row.status === "aborted" ? "aborted" :
    row.status === "open" ? "open" : null;

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border px-4 py-3 transition-fast",
        active ? "border-ring bg-accent/40" : "border-border bg-card",
        "hover:border-ring/50"
      )}
    >
      <button
        onClick={onOpen}
        className="flex flex-1 items-start gap-3 text-left min-w-0"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {row.summary ?? meta.label}
            </p>
            {statusBadge && (
              <Badge variant="outline" className="shrink-0 text-[10px] font-normal capitalize">
                {statusBadge}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {meta.label} · {time} · {row.actor_type} {row.actor_id.slice(0, 8)}
          </p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden="true" />
      </button>

      {onRestore && row.status === "committed" && row.origin !== "restore" && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={onRestore}
        >
          <Undo2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          Undo
        </Button>
      )}
    </div>
  );
}

function DetailBody({
  items,
  structural,
  plan,
}: {
  items: ChangeSetItem[];
  structural: StructuralEvent[];
  plan: RestorePlan;
}) {
  return (
    <div className="space-y-4 text-sm">
      {plan.blockers.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-warning">
          <p className="font-medium">This change set cannot be fully restored:</p>
          <ul className="mt-1 list-disc pl-4">
            {plan.blockers.map((b, i) => (
              <li key={i} className="text-xs">{b}</li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Content items
          <span className="ml-2 text-[10px] font-normal">{items.length}</span>
        </h3>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No content items.</p>
        ) : (
          <ul className="flex flex-col gap-1 list-none">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 rounded border border-border bg-card px-3 py-2">
                <Badge variant="secondary" className="shrink-0 text-[10px] font-normal capitalize">
                  {it.operation}
                </Badge>
                <span className="truncate text-xs">
                  {it.object_type} · {it.object_id.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {structural.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Structural events
            <span className="ml-2 text-[10px] font-normal">{structural.length}</span>
          </h3>
          <ul className="flex flex-col gap-1 list-none">
            {structural.map((se) => (
              <li key={se.id} className="flex items-center gap-2 rounded border border-border bg-card px-3 py-2">
                <Badge variant="outline" className="shrink-0 text-[10px] font-normal capitalize">
                  {se.event_type}
                </Badge>
                <span className="truncate text-xs">
                  {se.object_type} · {se.object_id.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
