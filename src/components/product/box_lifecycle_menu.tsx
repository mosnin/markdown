"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, MoreHorizontal } from "lucide-react";
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
}

export function BoxLifecycleMenu({ boxId, boxStatus }: BoxLifecycleMenuProps) {
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
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-fast",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          open && "bg-accent text-foreground"
        )}
        aria-label="Box actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-52 rounded-md border border-border bg-background shadow-md">
          <div className="p-1">
            {isArchived ? (
              <button
                onClick={() => act(() => unarchiveBoxAction(boxId))}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                  "hover:bg-accent disabled:opacity-50"
                )}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
                Unarchive box
              </button>
            ) : !confirmArchive ? (
              <button
                onClick={() => setConfirmArchive(true)}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
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
                    {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
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
            <div className="border-t border-border px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
