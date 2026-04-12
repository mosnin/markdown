"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { LEGAL_DOCS, LEGAL_DOC_ORDER, type LegalDocId } from "./registry";

/**
 * Sticky legal footer for the authenticated app.
 *
 * Renders a thin bar fixed at the bottom of the viewport with links to every
 * legal document. Clicking a link opens the document inline in a modal —
 * rendering the exact same content component used by the standalone marketing
 * pages, so copy stays in sync.
 */
export function LegalStickyFooter() {
  const [openId, setOpenId] = useState<LegalDocId | null>(null);
  const currentDoc = openId ? LEGAL_DOCS[openId] : null;
  const Content = currentDoc?.Content;

  return (
    <>
      <div
        role="contentinfo"
        aria-label="Legal links"
        className={cn(
          // z-30 keeps this above regular page content (z-0..z-20) but safely
          // below dropdowns (z-50+) and modal dialogs (z-50). This prevents
          // scrolling content from overlapping the legal bar while still
          // letting dropdowns and modals cover it as expected.
          "sticky bottom-0 left-0 right-0 z-30 shrink-0",
          "border-t border-border/40 bg-background/90 backdrop-blur-sm",
          "px-3 py-1.5",
        )}
      >
        <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/70">
          <li className="mr-1 text-muted-foreground/40">
            &copy; {new Date().getFullYear()} Poggle
          </li>
          {LEGAL_DOC_ORDER.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setOpenId(id)}
                className={cn(
                  "rounded px-1 transition-colors",
                  "hover:text-foreground hover:underline underline-offset-2",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {LEGAL_DOCS[id].shortLabel}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={!!openId} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-3xl p-0 sm:max-w-3xl">
          {currentDoc && (
            <>
              <DialogHeader className="border-b border-border/40 px-6 py-4">
                <DialogTitle className="text-lg font-semibold">
                  {currentDoc.title}
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {currentDoc.description}
                </p>
              </DialogHeader>
              <ScrollArea className="max-h-[70vh]">
                <div className="px-6 py-6">{Content && <Content />}</div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
