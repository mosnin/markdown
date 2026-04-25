"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface NoteMetadataChecklistProps {
  summary: string | null;
  tags: string[];
  linkCount: number;
  readHint: string | null;
  retrievalPriority: number;
  className?: string;
}

/**
 * Five-item checklist surfacing how well the note is configured for AI retrieval.
 * Identical criteria to NoteAiReadinessBadge — shown in detail here so authors
 * know exactly which fields to fill.
 */
export function NoteMetadataChecklist({
  summary,
  tags,
  linkCount,
  readHint,
  retrievalPriority,
  className,
}: NoteMetadataChecklistProps) {
  const items = [
    { label: "Summary written",        done: !!(summary && summary.trim().length > 0) },
    { label: "2+ tags added",          done: tags.length >= 2 },
    { label: "2+ semantic links",      done: linkCount >= 2 },
    { label: "Retrieval priority set", done: retrievalPriority > 0 },
    { label: "Read hint set",          done: !!readHint },
  ];

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        AI metadata — {doneCount} of {items.length} complete
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                item.done
                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                  : "bg-muted text-muted-foreground/40"
              )}
            >
              {item.done ? (
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              ) : (
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              )}
            </span>
            <span className={item.done ? "text-foreground/70" : "text-muted-foreground/60"}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
