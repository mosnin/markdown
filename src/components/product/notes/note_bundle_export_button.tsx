"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { assembleContextBundleAction } from "@/app/app/notes/actions";
import { type ContextBundle } from "@/server/domain/types/context_bundle";

interface NoteBundleExportButtonProps {
  noteId: string;
  noteTitle: string;
  noteSlug: string;
  className?: string;
}

/**
 * One-click button that assembles the context bundle for a note and downloads
 * it as a plain-text markdown file named `bundle-<slug>.txt`.
 *
 * Uses assembleContextBundleAction (same action as ContextBundleViewer) so the
 * format and scope are consistent.
 */
export function NoteBundleExportButton({
  noteId,
  noteTitle,
  noteSlug,
  className,
}: NoteBundleExportButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleExport() {
    setError(null);
    startTransition(async () => {
      const result = await assembleContextBundleAction(noteId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const content = formatBundleAsMarkdown(result.data, noteTitle);
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `bundle-${noteSlug || noteId}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className={cn("space-y-1", className)}>
      <button
        type="button"
        onClick={handleExport}
        disabled={isPending}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition-fast",
          "text-foreground/70 hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {isPending ? "Assembling bundle…" : "Download bundle (.txt)"}
      </button>
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatBundleAsMarkdown(bundle: ContextBundle, noteTitle: string): string {
  const lines: string[] = [];

  lines.push(`# Context Bundle: ${noteTitle}`);
  lines.push(`Assembled: ${new Date().toISOString()}`);
  if (bundle.truncated) {
    lines.push("(Bundle was truncated due to size limits)");
  }
  lines.push("");

  // Primary note
  lines.push("---");
  lines.push(`## [PRIMARY] ${bundle.primary_note.title}`);
  lines.push("");
  lines.push(bundle.primary_note.markdown_content ?? "");
  lines.push("");

  // Guide note
  if (bundle.guide_note) {
    lines.push("---");
    lines.push(`## [GUIDE] ${bundle.guide_note.title}`);
    lines.push("");
    lines.push(bundle.guide_note.markdown_content ?? "");
    lines.push("");
  }

  // Ancestor summary
  if (bundle.ancestor_summary_note) {
    lines.push("---");
    lines.push(`## [ANCESTOR SUMMARY] ${bundle.ancestor_summary_note.title}`);
    lines.push("");
    lines.push(bundle.ancestor_summary_note.markdown_content ?? "");
    lines.push("");
  }

  // Linked notes
  for (const linked of bundle.linked_notes) {
    lines.push("---");
    lines.push(`## [LINKED] ${linked.title}`);
    lines.push("");
    lines.push(linked.markdown_content ?? "");
    lines.push("");
  }

  return lines.join("\n");
}
