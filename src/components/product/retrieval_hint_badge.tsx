import { cn } from "@/lib/utils";

// Special read_hint values used by bundle assembly for ancestor summary resolution.
const READ_HINT_LABEL: Record<string, string> = {
  core_reference: "Core reference",
  read_first: "Read first",
  background: "Background",
  supplemental: "Supplemental",
};

interface RetrievalHintBadgeProps {
  readHint: string | null;
  retrievalPriority: number;
  className?: string;
}

/**
 * Compact display of a note's retrieval signals.
 *
 * Shows:
 *   - read_hint: free-form label (or known-value label) in a subdued italic
 *   - retrieval_priority: shown as p1, p2, … when > 0
 *
 * Both are optional — the component renders nothing if neither is set.
 * Used in note right pane (Info → Retrieval section) and other surfaces
 * where retrieval metadata should be visible without being loud.
 */
export function RetrievalHintBadge({
  readHint,
  retrievalPriority,
  className,
}: RetrievalHintBadgeProps) {
  const hasHint = !!readHint;
  const hasPriority = retrievalPriority > 0;

  if (!hasHint && !hasPriority) return null;

  const hintLabel = readHint
    ? (READ_HINT_LABEL[readHint] ?? readHint)
    : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {hasPriority && (
        <span
          className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
          title={`Retrieval priority ${retrievalPriority} — included in AI context bundles with higher preference`}
          aria-label={`Retrieval priority ${retrievalPriority}`}
        >
          p{retrievalPriority}
        </span>
      )}
      {hintLabel && (
        <span
          className="text-[11px] italic text-muted-foreground/70"
          title="Read hint — guidance for AI and human readers on how to use this note"
        >
          {hintLabel}
        </span>
      )}
    </div>
  );
}
