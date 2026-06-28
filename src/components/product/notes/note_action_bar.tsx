"use client";

/**
 * NoteActionBar
 *
 * The redesigned note-header action cluster. Replaces the old dense row of ~6
 * sharp text buttons (Ask AI / Save as template / Import / Export / Share /
 * Revoke + History + Comments + lifecycle) with a calm, Apple-clean layout:
 *
 *   - Primary actions stay visible as rounded-full pills: "Ask AI" (violet)
 *     and "Share".
 *   - Everything secondary collapses into a single ••• overflow menu:
 *     History, Comments, Save as template, Import, Export, Revoke link, and
 *     the note lifecycle actions (archive / unarchive / trash / restore).
 *
 * Every action is preserved and still calls the exact same server actions /
 * dialogs as before — this component only restyles and regroups the triggers.
 *
 * The overflow uses a lightweight self-managed popover (backdrop + absolutely
 * positioned panel) rather than the base-ui Menu primitive so the existing
 * self-contained action components (which each own their own dialog or
 * sub-popover and portal to <body>) compose cleanly inside it without fighting
 * the menu's focus/keyboard management.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { History, MessageSquare, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { AskPogInlineButton } from "@/components/product/ask_pog_inline_button";
import { ShareNoteButton } from "@/components/product/share_note_button";
import { SaveAsTemplateButton } from "@/components/product/save_as_template_button";
import { NoteImportButton } from "@/components/product/notes/note_import_dialog";
import { NoteExportMenu } from "@/components/product/export_menu";
import { NoteLifecycleMenu } from "@/components/product/notes/note_lifecycle_menu";

const MENU_ROW =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-fast hover:bg-accent hover:text-foreground";

interface NoteActionBarProps {
  noteId: string;
  noteTitle: string;
  noteStatus: "draft" | "active" | "archived" | "trashed";
}

export function NoteActionBar({ noteId, noteTitle, noteStatus }: NoteActionBarProps) {
  const [open, setOpen] = useState(false);

  // Close on Escape for keyboard users (the backdrop handles outside clicks).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* ── Primary: Ask AI (violet pill) ── */}
      <AskPogInlineButton
        label="Ask AI"
        prompt={`Looking at the note titled "${noteTitle}". Summarize the key ideas and suggest follow-up notes, missing links, or open questions worth exploring.`}
        className={cn(
          "rounded-full border-transparent bg-primary px-3.5 py-2 text-primary-foreground shadow-none",
          "hover:bg-primary/90 hover:text-primary-foreground"
        )}
        iconClassName="text-primary-foreground"
      />

      {/* ── Primary: Share (pill) ── */}
      <ShareNoteButton noteId={noteId} parts="share" />

      {/* ── Overflow: everything secondary ── */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-fast",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-accent text-foreground"
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              aria-label="More note actions"
              className={cn(
                "absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl bg-popover p-1.5 text-popover-foreground",
                "shadow-[0_8px_32px_-4px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-border/60"
              )}
            >
              {/* Navigation: history + comments (open the right-panel History tab) */}
              <Link href="?tab=more" className={MENU_ROW} onClick={() => setOpen(false)} role="menuitem">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Version history
              </Link>
              <Link href="?tab=more" className={MENU_ROW} onClick={() => setOpen(false)} role="menuitem">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Comments
              </Link>

              <div className="my-1 h-px bg-border/60" aria-hidden="true" />

              {/* Content actions. Dialog-based ones (template, import) close the
                  overflow on click so their modal isn't stacked under it; the
                  in-place sub-popovers (export) stay anchored to their row. */}
              <div onClick={() => setOpen(false)}>
                <SaveAsTemplateButton noteId={noteId} noteTitle={noteTitle} triggerClassName={MENU_ROW} />
              </div>
              <div onClick={() => setOpen(false)}>
                <NoteImportButton noteId={noteId} noteTitle={noteTitle} triggerClassName={MENU_ROW} />
              </div>
              {/* Export — rendered inline (two flat rows) to avoid a nested popover */}
              <NoteExportMenu noteId={noteId} noteTitle={noteTitle} inline />
              <ShareNoteButton noteId={noteId} parts="revoke-row" />

              <div className="my-1 h-px bg-border/60" aria-hidden="true" />

              {/* Lifecycle (archive / trash / restore) — its own menu, styled as a row */}
              <NoteLifecycleMenu noteId={noteId} noteStatus={noteStatus} triggerClassName={MENU_ROW} triggerLabel="Manage note" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
