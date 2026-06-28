"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreHorizontal } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  archiveBoxAction,
  unarchiveBoxAction,
} from "@/app/app/boxes/[box_id]/actions";

/**
 * Box lifecycle menu — archive and unarchive.
 *
 * Box trash is deferred to V1+. Archive is the reversible "hide this box"
 * mechanism. Cascades to all non-trashed folders and notes in the box.
 */

interface BoxLifecycleMenuProps {
  boxId: string;
  boxStatus: "active" | "archived";
  /**
   * Optional trigger styling override. When set (e.g. by the box header's
   * ••• overflow menu) it replaces the default icon-only button so this can
   * render as a full-width menu row.
   */
  triggerClassName?: string;
  /** Optional visible label for the trigger (used with triggerClassName). */
  triggerLabel?: string;
}

export function BoxLifecycleMenu({
  boxId,
  boxStatus,
  triggerClassName,
  triggerLabel,
}: BoxLifecycleMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function act(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.success) {
        setOpen(false);
        setConfirmArchive(false);
        router.refresh();
      } else {
        setError(result.error ?? "Action failed");
      }
    });
  }

  const isArchived = boxStatus === "archived";

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setError(null); setConfirmArchive(false); }}
        className={
          triggerClassName ??
          cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-fast",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            open && "bg-accent text-foreground"
          )
        }
        aria-label="Box actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {triggerLabel ? (
          <>
            {isArchived ? (
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {triggerLabel}
          </>
        ) : (
          <MoreHorizontal className="h-4 w-4" />
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[55]"
            onClick={() => { setOpen(false); setConfirmArchive(false); }}
            aria-hidden
          />
          <div role="menu" aria-label="Box actions" className="absolute right-0 top-full z-[60] mt-1.5 min-w-52 rounded-2xl bg-popover p-1 text-popover-foreground shadow-[0_8px_32px_-4px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-border/60">
          <div className="p-1">
            {isArchived ? (
              <button
                role="menuitem"
                onClick={() => act(() => unarchiveBoxAction(boxId))}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-fast",
                  "hover:bg-accent disabled:opacity-50"
                )}
              >
                {isPending ? <Spinner size={16} /> : <ArchiveRestore className="h-4 w-4" />}
                Unarchive box
              </button>
            ) : !confirmArchive ? (
              <button
                role="menuitem"
                onClick={() => setConfirmArchive(true)}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-fast",
                  "hover:bg-accent disabled:opacity-50"
                )}
              >
                <Archive className="h-4 w-4" />
                Archive box
              </button>
            ) : (
              <div className="px-3 py-2">
                <p className="text-xs text-muted-foreground mb-2">
                  Archive this box and all its active content?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => act(() => archiveBoxAction(boxId))}
                    disabled={isPending}
                    className="rounded px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-50 flex items-center gap-1"
                  >
                    {isPending && <Spinner size={12} />}
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmArchive(false)}
                    disabled={isPending}
                    className="rounded px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-1 border-t border-border/60 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}
