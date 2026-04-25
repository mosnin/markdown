"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { assembleContextBundleAction } from "@/app/app/notes/actions";
import type { ContextBundle } from "@/server/domain/types/context_bundle";

/**
 * One-Click Bundle Export Button
 *
 * Assembles the context bundle for the note and triggers a browser download
 * as `bundle-<note-slug>.txt` with a markdown-formatted document.
 */

interface NoteBundleExportButtonProps {
  noteId: string;
  noteTitle: string;
  noteSlug: string;
  className?: string;
}

function formatBundleAsMarkdown(bundle: ContextBundle): string {
  const lines: string[] = [];
  const now = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  lines.push(`# Context Bundle: ${bundle.target_note.title}`);
  lines.push(`Generated: ${now}`);
  lines.push(`Box: ${bundle.box.name}`);
  lines.push("");

  // Guide note section
  if (bundle.guide_note) {
    lines.push("---");
    lines.push("");
    lines.push(`## Guide Note: ${bundle.guide_note.title}`);
    if (bundle.guide_note.summary) {
      lines.push("");
      lines.push(`*${bundle.guide_note.summary}*`);
    }
    if (bundle.guide_note.tags.length > 0) {
      lines.push("");
      lines.push(`Tags: ${bundle.guide_note.tags.join(", ")}`);
    }
    lines.push("");
  }

  // Ancestor summary section
  if (bundle.ancestor_summary_note) {
    lines.push("---");
    lines.push("");
    lines.push(`## Ancestor Summary: ${bundle.ancestor_summary_note.title}`);
    if (bundle.ancestor_summary_note.summary) {
      lines.push("");
      lines.push(`*${bundle.ancestor_summary_note.summary}*`);
    }
    lines.push("");
  }

  // Target note (entry point)
  lines.push("---");
  lines.push("");
  lines.push(`## ${bundle.target_note.title} (Entry Point)`);
  if (bundle.target_note.summary) {
    lines.push("");
    lines.push(`*${bundle.target_note.summary}*`);
  }
  if (bundle.target_note.read_hint) {
    lines.push("");
    lines.push(`Read hint: ${bundle.target_note.read_hint}`);
  }
  if (bundle.target_note.tags.length > 0) {
    lines.push("");
    lines.push(`Tags: ${bundle.target_note.tags.join(", ")}`);
  }
  lines.push("");

  // Linked notes
  for (const linked of bundle.linked_notes) {
    lines.push("---");
    lines.push("");
    const dirLabel = linked.direction === "outgoing" ? "→" : "←";
    const relLabel = linked.relationship_type.replace(/_/g, " ");
    lines.push(`## Related: ${linked.title} (${dirLabel} ${relLabel})`);
    if (linked.summary) {
      lines.push("");
      lines.push(`*${linked.summary}*`);
    }
    if (linked.relationship_note) {
      lines.push("");
      lines.push(`Link note: ${linked.relationship_note}`);
    }
    if (linked.tags.length > 0) {
      lines.push("");
      lines.push(`Tags: ${linked.tags.join(", ")}`);
    }
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(
    `*Assembled at ${bundle.assembly_metadata.assembled_at}. ` +
      `${bundle.linked_notes.length} linked notes included.` +
      (bundle.truncated ? " Bundle was truncated." : "") +
      "*"
  );

  return lines.join("\n");
}

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

      const content = formatBundleAsMarkdown(result.data);
      const slug = noteSlug || noteTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const filename = `bundle-${slug}.txt`;

      try {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      } catch {
        setError("Failed to download file");
      }
    });
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <button
        type="button"
        onClick={handleExport}
        disabled={isPending}
        title="Export AI context bundle for this note as a text file"
        aria-label="Export AI context bundle"
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-accent hover:border-border",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {isPending ? "Assembling…" : "Export for AI"}
      </button>
      {error && (
        <p className="text-[10px] text-destructive">{error}</p>
      )}
    </div>
  );
}
