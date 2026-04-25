"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AI Context Checklist
 *
 * Shows the 5 AI readiness criteria as a compact checklist with check/x icons.
 * Unchecked items could guide users on what to improve.
 *
 * Displayed in the note info panel.
 */

interface NoteMetadataChecklistProps {
  summary: string | null;
  tags: string[];
  linkCount: number;
  readHint: string | null;
  retrievalPriority: number;
  className?: string;
}

interface ChecklistItem {
  label: string;
  done: boolean;
  hint: string;
}

export function NoteMetadataChecklist({
  summary,
  tags,
  linkCount,
  readHint,
  retrievalPriority,
  className,
}: NoteMetadataChecklistProps) {
  const items: ChecklistItem[] = [
    {
      label: "Summary written",
      done: !!(summary && summary.trim().length > 0),
      hint: "Add a one-line summary for context retrieval",
    },
    {
      label: "Add 2+ tags",
      done: tags.length >= 2,
      hint: "Tags help categorize and retrieve this note",
    },
    {
      label: "Has 2+ links",
      done: linkCount >= 2,
      hint: "Links to related notes improve context bundles",
    },
    {
      label: "Set retrieval priority",
      done: retrievalPriority > 0,
      hint: "Priority affects context bundle inclusion order",
    },
    {
      label: "Read hint set",
      done: !!readHint,
      hint: "Guides AI and human readers on how to use this note",
    },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = completedCount === total;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          AI Context Checklist
        </p>
        <span
          className={cn(
            "text-[10px] font-medium",
            allDone ? "text-green-500" : "text-muted-foreground/60"
          )}
        >
          {completedCount} of {total}
        </span>
      </div>

      <ul className="flex flex-col gap-1" role="list">
        {items.map((item) => (
          <li
            key={item.label}
            title={item.done ? item.label : item.hint}
            className={cn(
              "flex items-center gap-2 rounded-sm px-1 py-0.5 text-xs",
              item.done ? "text-foreground/70" : "text-muted-foreground/50"
            )}
          >
            {item.done ? (
              <Check
                className="h-3 w-3 shrink-0 text-green-500"
                aria-label="Complete"
              />
            ) : (
              <X
                className="h-3 w-3 shrink-0 text-muted-foreground/40"
                aria-label="Incomplete"
              />
            )}
            <span className={cn(!item.done && "line-through decoration-muted-foreground/20")}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>

      {!allDone && (
        <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
          Complete all items to maximize AI context quality.
        </p>
      )}
    </div>
  );
}
