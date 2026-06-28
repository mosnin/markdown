"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2, RotateCcw, MoreHorizontal } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
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
  /**
   * Optional trigger styling override. When set (e.g. by the note header's
   * ••• overflow menu) it replaces the default icon-only button so this can
   * render as a full-width menu row.
   */
  triggerClassName?: string;
  /** Optional visible label for the trigger (used with triggerClassName). */
  triggerLabel?: string;
}

export function NoteLifecycleMenu({
  noteId,
  noteStatus,
  triggerClassName,
  triggerLabel,
}: NoteLifecycleMenuProps) {
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
        className={
          triggerClassName ??
          cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-fast",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            open && "bg-accent text-foreground"
          )
        }
        aria-label="Note actions"
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
            onClick={() => { setOpen(false); setConfirmTrash(false); }}
            aria-hidden
          />
        <div role="menu" aria-label="Note actions" className="absolute right-0 top-full z-[60] mt-1.5 min-w-52 rounded-2xl bg-popover p-1 text-popover-foreground shadow-[0_8px_32px_-4px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-border/60">
          <div className="p-1">
            {!isTrashed && (
              <>
                {isArchived ? (
                  <button
                    role="menuitem"
                    onClick={() => act(() => unarchiveNoteAction(noteId))}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-fast",
                      "hover:bg-accent disabled:opacity-50"
                    )}
                  >
                    {isPending ? <Spinner size={16} /> : <ArchiveRestore className="h-4 w-4" />}
                    Unarchive note
                  </button>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => act(() => archiveNoteAction(noteId))}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-fast",
                      "hover:bg-accent disabled:opacity-50"
                    )}
                  >
                    {isPending ? <Spinner size={16} /> : <Archive className="h-4 w-4" />}
                    Archive note
                  </button>
                )}

                <div className="my-1 h-px bg-border/60" />

                {!confirmTrash ? (
                  <button
                    role="menuitem"
                    onClick={() => setConfirmTrash(true)}
                    disabled={isPending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-fast",
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
                onClick={() => act(() => restoreNoteAction(noteId))}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-fast",
                  "hover:bg-accent disabled:opacity-50"
                )}
              >
                {isPending ? <Spinner size={16} /> : <RotateCcw className="h-4 w-4" />}
                Restore from trash
              </button>
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
