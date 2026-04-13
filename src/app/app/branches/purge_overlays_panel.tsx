"use client";

import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { purgeDiscardedOverlaysAction } from "./admin_actions";

/**
 * Admin-only panel shown at the bottom of /app/branches.
 *
 * Explains the overlay-purge operation and provides a single "Purge N
 * overlay rows" button that presents a confirmation dialog before
 * executing the server action.
 *
 * This component is only rendered for admin / owner roles — the server
 * component wrapper checks the role before including it in the tree. The
 * server action itself also re-validates the role, so there is no
 * privilege-escalation risk if the component were somehow rendered for a
 * non-admin.
 */
export function PurgeOverlaysPanel({
  overlayCount,
}: {
  overlayCount: number;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; deletedCount: number }
    | { kind: "err"; message: string }
    | null
  >(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await purgeDiscardedOverlaysAction();
      setConfirmOpen(false);
      if (res.ok) {
        setResult({ kind: "ok", deletedCount: res.data.deletedCount });
      } else {
        setResult({ kind: "err", message: res.error });
      }
    });
  }

  return (
    <section
      aria-label="Admin: purge discarded overlay rows"
      className="mt-6 rounded-lg border border-border bg-card px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="flex-1 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Admin — overlay maintenance
          </p>
          <p className="text-sm text-muted-foreground">
            When a branch is discarded or promoted, its{" "}
            <code className="text-xs">branch_package_metadata</code> overlay
            rows are kept for audit purposes but are no longer needed for live
            edits. Over time these accumulate and consume space. Use this
            operation to reclaim that disk.
          </p>
          <p className="text-sm text-muted-foreground">
            Only overlays whose parent branch has status{" "}
            <strong>discarded</strong> or <strong>promoted</strong> are
            removed. Overlays belonging to open (live) branches are never
            touched.
          </p>

          {result && (
            <p
              className={
                result.kind === "ok"
                  ? "text-sm text-foreground"
                  : "text-sm text-destructive"
              }
              role={result.kind === "ok" ? "status" : "alert"}
            >
              {result.kind === "ok"
                ? `Purged ${result.deletedCount} overlay row${result.deletedCount === 1 ? "" : "s"}.`
                : result.message}
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={pending}
          >
            Purge {overlayCount} overlay row{overlayCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(v) => !v && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purge discarded overlay rows?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete{" "}
            <strong>
              {overlayCount} overlay row{overlayCount === 1 ? "" : "s"}
            </strong>{" "}
            from <code className="text-xs">branch_package_metadata</code> whose
            parent branch is discarded or promoted. This cannot be undone.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Overlays on open (live) branches are never deleted by this
            operation.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? "Purging…" : "Purge overlay rows"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
