"use client";

import { useState } from "react";
import { Check, Clipboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type Note } from "@/server/domain/types/note";
import { formatFrontmatterForCopy } from "@/lib/link_frontmatter";

interface CopyFrontmatterButtonProps {
  outgoing: NoteLink[];
  allBoxNotes: Note[];
}

/**
 * "Copy frontmatter" button for the Links panel.
 *
 * Generates the YAML link-frontmatter block from the current outgoing links
 * and copies it to the clipboard. Useful for pasting into external tools or
 * static site generators that parse YAML front-matter.
 */
export function CopyFrontmatterButton({
  outgoing,
  allBoxNotes,
}: CopyFrontmatterButtonProps) {
  const [copied, setCopied] = useState(false);

  const noteMap = new Map(allBoxNotes.map((n) => [n.id, n]));
  const frontmatter = formatFrontmatterForCopy(outgoing, noteMap);

  if (!frontmatter) return null;

  async function handleCopy() {
    if (!frontmatter) return;
    try {
      await navigator.clipboard.writeText(frontmatter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Link frontmatter
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        YAML block listing all outgoing links — paste into any Markdown file to
        embed link topology.
      </p>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={cn(
          "flex items-center gap-1.5 self-start rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
          copied
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Copied!
          </>
        ) : (
          <>
            <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
            Copy frontmatter
          </>
        )}
      </button>
      {/* Preview */}
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
        {frontmatter}
      </pre>
    </div>
  );
}
