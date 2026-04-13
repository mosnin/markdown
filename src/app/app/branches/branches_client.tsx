"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  GitBranch,
  PackageOpen,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createBranchAction,
  promoteBranchAction,
  discardBranchAction,
  setActiveBranchAction,
} from "./actions";
import type { DraftBranch } from "@/server/services/branch_service";

type Row = DraftBranch & { head_count: number };

/**
 * Client UI for the /app/branches page.
 *
 * Actions:
 *   - Create branch (opens a dialog)
 *   - Switch active branch (or clear to main)
 *   - Promote: walks the branch's heads, advances each object's
 *     current_version_id on main, records the whole thing as one
 *     change set.
 *   - Discard: marks branch discarded; heads stay as audit trail.
 *
 * Read-only for viewers — every write button is hidden when
 * canWrite=false, and the server actions re-check on every call.
 */
export function BranchesClient({
  rows,
  activeBranchId,
  canWrite,
}: {
  rows: Row[];
  activeBranchId: string | null;
  canWrite: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [promoteId, setPromoteId] = useState<string | null>(null);
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const openBranches = rows.filter((r) => r.status === "open");
  const closedBranches = rows.filter((r) => r.status !== "open");

  return (
    <div className="space-y-5">
      {toast && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
            toast.kind === "ok"
              ? "border-border bg-card"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          )}
          role={toast.kind === "ok" ? "status" : "alert"}
        >
          <p className="flex-1">{toast.text}</p>
          <button
            onClick={() => setToast(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Active-branch header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">Editing against:</span>
          <strong className="text-foreground">
            {activeBranchId
              ? rows.find((r) => r.id === activeBranchId)?.name ?? "Unknown branch"
              : "main"}
          </strong>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            New branch
          </Button>
        )}
      </div>

      {openBranches.length === 0 ? (
        <EmptyState canWrite={canWrite} onNew={() => setCreateOpen(true)} />
      ) : (
        <section>
          <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Open branches
            <span className="ml-2 text-[10px] font-normal">{openBranches.length}</span>
          </h2>
          <ul className="flex flex-col gap-2 list-none">
            {openBranches.map((b) => (
              <li key={b.id}>
                <BranchRow
                  row={b}
                  active={activeBranchId === b.id}
                  canWrite={canWrite}
                  onSwitch={async (id) => {
                    const res = await setActiveBranchAction(id);
                    if (res.ok) {
                      window.location.reload();
                    } else setToast({ kind: "err", text: res.error });
                  }}
                  onPromote={() => setPromoteId(b.id)}
                  onDiscard={() => setDiscardId(b.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {closedBranches.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Closed
            <span className="ml-2 text-[10px] font-normal">{closedBranches.length}</span>
          </h2>
          <ul className="flex flex-col gap-2 list-none">
            {closedBranches.map((b) => (
              <li key={b.id}>
                <BranchRow row={b} active={false} canWrite={false} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          window.location.reload();
        }}
      />

      <ConfirmDialog
        open={!!promoteId}
        title="Promote this branch?"
        body={
          <>
            <p className="text-sm text-muted-foreground">
              This will advance every object the branch has touched to
              its branch-head version on main, as one grouped history
              entry. The branch is marked promoted and cannot be edited
              further.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The promotion itself is a change set — you can undo it
              from History if it doesn&apos;t turn out right.
            </p>
          </>
        }
        confirmLabel="Promote"
        onCancel={() => setPromoteId(null)}
        onConfirm={async () => {
          if (!promoteId) return;
          const res = await promoteBranchAction(promoteId);
          setPromoteId(null);
          if (res.ok) {
            setToast({
              kind: "ok",
              text: `Promoted ${res.data.promotedObjects.length} object${res.data.promotedObjects.length === 1 ? "" : "s"} to main.`,
            });
            window.location.reload();
          } else {
            setToast({ kind: "err", text: res.error });
          }
        }}
      />

      <ConfirmDialog
        open={!!discardId}
        title="Discard this branch?"
        body={
          <p className="text-sm text-muted-foreground">
            The branch is marked discarded and disappears from the open
            list. The version rows written against the branch stay as
            audit trail — nothing is deleted.
          </p>
        }
        confirmLabel="Discard"
        destructive
        onCancel={() => setDiscardId(null)}
        onConfirm={async () => {
          if (!discardId) return;
          const res = await discardBranchAction(discardId);
          setDiscardId(null);
          if (res.ok) {
            setToast({ kind: "ok", text: "Branch discarded." });
            window.location.reload();
          } else {
            setToast({ kind: "err", text: res.error });
          }
        }}
      />
    </div>
  );
}

function BranchRow({
  row,
  active,
  canWrite,
  onSwitch,
  onPromote,
  onDiscard,
}: {
  row: Row;
  active: boolean;
  canWrite: boolean;
  onSwitch?: (id: string | null) => void;
  onPromote?: () => void;
  onDiscard?: () => void;
}) {
  const created = new Date(row.created_at).toLocaleString();
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 transition-fast",
        active ? "border-ring bg-accent/40" : "border-border bg-card"
      )}
    >
      <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* Name links through to the detail / preview page so users
              can inspect heads + diffs before promoting. */}
          <Link
            href={`/app/branches/${row.id}`}
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {row.name}
          </Link>
          {active && (
            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
              <Check className="h-3 w-3 mr-1" aria-hidden="true" />
              active
            </Badge>
          )}
          {row.status !== "open" && (
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal capitalize">
              {row.status}
            </Badge>
          )}
        </div>
        {row.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.description}</p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          {row.head_count} head{row.head_count === 1 ? "" : "s"} · Created {created}
        </p>
      </div>
      {canWrite && row.status === "open" && (
        <div className="flex shrink-0 gap-1">
          {active ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitch?.(null)}
              className="text-xs"
            >
              Switch to main
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitch?.(row.id)}
              className="text-xs"
            >
              Switch
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onPromote}
            disabled={row.head_count === 0}
            className="text-xs"
            title={row.head_count === 0 ? "No edits to promote" : undefined}
          >
            <PackageOpen className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            Promote
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            aria-label={`Discard ${row.name}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ canWrite, onNew }: { canWrite: boolean; onNew: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      <GitBranch className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">No open branches</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Branches let you make exploratory edits to notes, files,
        skills, and agents that never touch main until you promote them.
        Discard if the experiment doesn&apos;t work.
      </p>
      {canWrite && (
        <Button size="sm" className="mt-4" onClick={onNew}>
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          New branch
        </Button>
      )}
    </div>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createBranchAction(name, description || null);
      if (res.ok) {
        setName("");
        setDescription("");
        setError(null);
        onCreated();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New draft branch</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Name
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={pending}
              placeholder="e.g. Rework retrieval prompt"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description (optional)
            </span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
            />
          </label>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => startTransition(async () => { await onConfirm(); })}
            disabled={pending}
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {pending ? "…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
