"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateFileStatusAction } from "@/app/app/files/actions";
import { Spinner } from "@/components/ui/spinner";

interface FileLifecycleMenuProps {
  fileId: string;
  fileStatus: "draft" | "active" | "archived" | "trashed";
}

/**
 * File lifecycle menu — archive, unarchive, trash.
 *
 * Follows the same interaction pattern as NoteLifecycleMenu.
 * Available actions depend on the current status.
 * Confirmation is required for trash.
 */
export function FileLifecycleMenu({ fileId, fileStatus }: FileLifecycleMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function act(status: "archived" | "active" | "trashed") {
    setError(null);
    startTransition(async () => {
      const result = await updateFileStatusAction(fileId, status);
      if (result.ok) {
        setOpen(false);
        setConfirmTrash(false);
        router.refresh();
      } else {
        setError(result.error ?? "Action failed");
      }
    });
  }

  const isArchived = fileStatus === "archived";
  const isTrashed = fileStatus === "trashed";

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
          setConfirmTrash(false);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-accent text-foreground"
        )}
        aria-label="File lifecycle menu"
        aria-expanded={open}
      >
        {isPending ? (
          <Spinner size={14} aria-hidden="true" />
        ) : (
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">More</span>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setOpen(false); setConfirmTrash(false); }}
            aria-hidden="true"
          />
          {/* Menu */}
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border bg-popover shadow-md">
            <div className="py-1">
              {!isTrashed && (
                isArchived ? (
                  <button
                    type="button"
                    onClick={() => act("active")}
                    disabled={isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                    Unarchive
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => act("archived")}
                    disabled={isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    Archive
                  </button>
                )
              )}

              {!isTrashed && (
                <div className="mx-1 my-1 border-t border-border" />
              )}

              {isTrashed ? (
                <button
                  type="button"
                  onClick={() => act("active")}
                  disabled={isPending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                >
                  <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                  Restore
                </button>
              ) : confirmTrash ? (
                <div className="px-3 py-2">
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Move to trash?
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => act("trashed")}
                      disabled={isPending}
                      className="rounded-md bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                    >
                      Trash
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmTrash(false)}
                      className="rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmTrash(true)}
                  disabled={isPending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Move to trash
                </button>
              )}
            </div>

            {error && (
              <div className="border-t border-border px-3 py-2">
                <p className="text-[11px] text-destructive">{error}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
