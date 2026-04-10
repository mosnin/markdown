"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2, RotateCcw, MoreHorizontal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  archiveNoteAction,
  unarchiveNoteAction,
  trashNoteAction,
  restoreNoteAction,
} from "@/app/app/notes/[note_id]/actions";

/**
 * Note lifecycle menu — archive, unarchive, trash, restore.
 *
 * Displayed on the note page. The available actions depend on the note's
 * current status. Confirmation is required for trash to prevent accidents.
 *
 * Guide note protection errors are surfaced inline — the user sees the
 * reason (guide note assignment must be cleared first) without a crash.
 */

interface NoteLifecycleMenuProps {
  noteId: string;
  noteStatus: "draft" | "active" | "archived" | "trashed";
}

export function NoteLifecycleMenu({ noteId, noteStatus }: NoteLifecycleMenuProps) {
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

  const isArchived = noteStatus === "archived";
  const isTrashed = noteStatus === "trashed";

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setError(null); setConfirmTrash(false); }}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-fast",
          "text-muted-foreground hover:text-foreground hover:bg-accent",
          open && "bg-accent text-foreground"
        )}
        aria-label="Note actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div role="menu" aria-label="Note actions" className="absolute right-0 top-full z-50 mt-1 min-w-48 rounded-md border border-border bg-background shadow-md">
          <div className="p-1">
            {!isTrashed && (
              <>
                {isArchived ? (
                  <button
                    role="menuitem"
                    onClick={() => act(() => unarchiveNoteAction(noteId))}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                      "hover:bg-accent disabled:opacity-50"
                    )}
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
                    Unarchive note
                  </button>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => act(() => archiveNoteAction(noteId))}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                      "hover:bg-accent disabled:opacity-50"
                    )}
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                    Archive note
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
                    Move to trash
                  </button>
                ) : (
                  <div className="px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-2">Move to trash?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => act(() => trashNoteAction(noteId))}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/80 disabled:opacity-50 flex items-center gap-1"
                      >
                        {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
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
                onClick={() => act(() => restoreNoteAction(noteId))}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                  "hover:bg-accent disabled:opacity-50"
                )}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Restore from trash
              </button>
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
