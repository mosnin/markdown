"use client";

/**
 * BoxActionBar
 *
 * The redesigned box-header action cluster. Replaces the old dense row of ~9
 * sharp text buttons (Create note / Create folder / Ask AI / Import / Export /
 * Templates / Public toggle / Share / Lifecycle) with a calm, Apple-clean
 * layout that mirrors NoteActionBar:
 *
 *   - Primary actions stay visible as rounded-full pills: "New note" (violet
 *     dialog trigger) and "Ask AI".
 *   - Everything secondary collapses into a single ••• overflow menu:
 *     New folder, Templates, Import, Export, Make public, Share / Revoke link,
 *     and the box lifecycle actions (archive / unarchive).
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
import { FileText, FolderPlus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Folder } from "@/server/domain/types/folder";
import { CreateNoteDialog } from "@/components/product/create/create_note_dialog";
import { CreateFolderDialog } from "@/components/product/create/create_folder_dialog";
import { AskPogInlineButton } from "@/components/product/ask_pog_inline_button";
import { ImportTriggerButton } from "@/components/product/import_dialog";
import { BoxExportMenu } from "@/components/product/export_menu";
import { BoxPublicToggle } from "@/components/product/boxes/box_public_toggle";
import { ShareBoxButton } from "@/components/product/share_box_button";
import { BoxLifecycleMenu } from "@/components/product/boxes/box_lifecycle_menu";

const MENU_ROW =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-fast hover:bg-accent hover:text-foreground";

interface SavedTemplate {
  id: string;
  name: string;
  description: string | null;
  markdown_content: string;
}

interface BoxActionBarProps {
  boxId: string;
  boxName: string;
  boxStatus: "active" | "archived";
  isPublic: boolean;
  folders: Folder[];
  savedTemplates: SavedTemplate[];
}

export function BoxActionBar({
  boxId,
  boxName,
  boxStatus,
  isPublic,
  folders,
  savedTemplates,
}: BoxActionBarProps) {
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
      {/* ── Primary: New note (violet dialog trigger) ── */}
      <CreateNoteDialog
        boxId={boxId}
        folders={folders}
        savedTemplates={savedTemplates}
      />

      {/* ── Primary: Ask AI (violet pill) ── */}
      <AskPogInlineButton
        label="Ask AI"
        prompt={`Working in the box "${boxName}". Start by summarizing what's already in this box and what's missing, then draft any follow-up notes I should have.`}
        className={cn(
          "rounded-full border-transparent bg-primary px-3.5 py-2 text-primary-foreground shadow-none",
          "hover:bg-primary/90 hover:text-primary-foreground"
        )}
        iconClassName="text-primary-foreground"
      />

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
              aria-label="More box actions"
              className={cn(
                "absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl bg-popover p-1.5 text-popover-foreground",
                "shadow-[0_8px_32px_-4px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-border/60"
              )}
            >
              {/* Creation: new folder (dialog — closes the overflow on click so
                  its modal isn't stacked under it). */}
              <div onClick={() => setOpen(false)}>
                <CreateFolderDialog boxId={boxId} triggerClassName={MENU_ROW} />
              </div>

              {/* Templates — plain navigation */}
              <Link
                href={`/app/boxes/${boxId}/templates`}
                className={MENU_ROW}
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Templates
              </Link>

              <div className="my-1 h-px bg-border/60" aria-hidden="true" />

              {/* Content actions. Dialog-based ones (import) close the overflow
                  on click; the inline export rows stay anchored to their rows. */}
              <div onClick={() => setOpen(false)}>
                <ImportTriggerButton
                  boxId={boxId}
                  boxName={boxName}
                  folders={folders.map((f) => ({
                    id: f.id,
                    name: f.name,
                    path_cache: f.path_cache,
                  }))}
                  triggerClassName={MENU_ROW}
                />
              </div>
              {/* Export — rendered inline (flat rows) to avoid a nested popover */}
              <BoxExportMenu boxId={boxId} boxName={boxName} inline />

              <div className="my-1 h-px bg-border/60" aria-hidden="true" />

              {/* Sharing: public toggle + share / revoke link */}
              <BoxPublicToggle boxId={boxId} initialIsPublic={isPublic} variant="row" />
              <ShareBoxButton boxId={boxId} parts="share-row" />
              <ShareBoxButton boxId={boxId} parts="revoke-row" />

              <div className="my-1 h-px bg-border/60" aria-hidden="true" />

              {/* Lifecycle (archive / unarchive) — its own menu, styled as a row */}
              <BoxLifecycleMenu
                boxId={boxId}
                boxStatus={boxStatus}
                triggerClassName={MENU_ROW}
                triggerLabel="Manage box"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
