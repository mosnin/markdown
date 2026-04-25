"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2, RotateCcw, MoreHorizontal } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  archiveFolderAction,
  unarchiveFolderAction,
  trashFolderAction,
  restoreFolderAction,
} from "@/app/app/boxes/[box_id]/actions";

/**
 * Folder lifecycle menu — archive, unarchive, trash, restore.
 *
 * Used in the box tree view. Available actions depend on the folder's current
 * status. Subtree operations (archive/trash/restore entire folder hierarchy)
 * are confirmed before executing. Guide note protection errors surface inline.
 */

interface FolderLifecycleMenuProps {
  folderId: string;
  folderStatus: "active" | "archived" | "trashed";
}

export function FolderLifecycleMenu({ folderId, folderStatus }: FolderLifecycleMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function act(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.success) {
        setOpen(false);
        setConfirmTrash(false);
        router.refresh();
      } else {
        setError(result.error ?? "Action failed");
      }
    });
  }

  const isArchived = folderStatus === "archived";
  const isTrashed = folderStatus === "trashed";

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setError(null); setConfirmTrash(false); }}
        className={cn(
          "flex items-center gap-1.5 rounded px-1.5 py-1 text-sm transition-fast",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          open && "bg-accent text-foreground"
        )}
        aria-label="Folder actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setOpen(false); setConfirmTrash(false); }}
            aria-hidden
          />
          <div role="menu" aria-label="Folder actions" className="absolute right-0 top-full z-50 mt-1 min-w-52 rounded-md border border-border bg-background shadow-md">
          <div className="p-1">
            {!isTrashed && (
              <>
                {isArchived ? (
                  <button
                    role="menuitem"
                    onClick={() => act(() => unarchiveFolderAction(folderId))}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                      "hover:bg-accent disabled:opacity-50"
                    )}
                  >
                    {isPending ? <Spinner size={16} /> : <ArchiveRestore className="h-4 w-4" />}
                    Unarchive subtree
                  </button>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => act(() => archiveFolderAction(folderId))}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                      "hover:bg-accent disabled:opacity-50"
                    )}
                  >
                    {isPending ? <Spinner size={16} /> : <Archive className="h-4 w-4" />}
                    Archive subtree
                  </button>
                )}

                <div className="my-1 border-t border-border" />

                {!confirmTrash ? (
                  <button
                    role="menuitem"
                    onClick={() => setConfirmTrash(true)}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                      "text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                    Move subtree to trash
                  </button>
                ) : (
                  <div className="px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-2">
                      Move this folder and all its contents to trash?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => act(() => trashFolderAction(folderId))}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/80 disabled:opacity-50 flex items-center gap-1"
                      >
                        {isPending && <Spinner size={12} />}
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmTrash(false)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {isTrashed && (
              <button
                role="menuitem"
                onClick={() => act(() => restoreFolderAction(folderId))}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                  "hover:bg-accent disabled:opacity-50"
                )}
              >
                {isPending ? <Spinner size={16} /> : <RotateCcw className="h-4 w-4" />}
                Restore subtree from trash
              </button>
            )}
          </div>

          {error && (
            <div className="border-t border-border px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}
