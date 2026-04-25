"use client";

/**
 * NoteAiTimeline
 *
 * Collapsed vertical timeline showing AI-related version history for a note.
 * Entries are versions where:
 *   - change_origin is 'generated' or 'proposal_approved'
 *   - OR actor_type is 'connection' or 'system'
 *
 * Shows the most recent 3 entries collapsed; a "Show more" link expands to
 * the full set. Empty state: "No AI actions on this note yet".
 */

import { useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { NoteVersion } from "@/server/domain/types/note_version";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiTimelineEntry extends NoteVersion {
  /** Optional actor display name (e.g. connection name). */
  actorName?: string | null;
}

interface NoteAiTimelineProps {
  /** AI-filtered version entries — caller is responsible for filtering. */
  entries: AiTimelineEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLLAPSED_COUNT = 3;

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60)
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30)
    return `${days} day${days !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? "s" : ""} ago`;
}

const ORIGIN_LABEL: Record<string, string> = {
  generated: "Generated",
  proposal_approved: "Proposal approved",
  human_edit: "Human edit",
  import: "Import",
  rollback: "Rollback",
  promotion: "Promoted",
};

const ORIGIN_BADGE_CLASS: Record<string, string> = {
  generated:
    "border-purple-300/60 bg-purple-50/60 text-purple-700 dark:border-purple-600/40 dark:bg-purple-900/20 dark:text-purple-400",
  proposal_approved:
    "border-green-300/60 bg-green-50/60 text-green-700 dark:border-green-600/40 dark:bg-green-900/20 dark:text-green-400",
};

function actorLabel(entry: AiTimelineEntry): string {
  if (entry.actor_type === "connection") {
    return entry.actorName ? `Connection: ${entry.actorName}` : "Connection";
  }
  if (entry.actor_type === "system") return "AI · System";
  if (entry.actor_type === "user") return "Human";
  return entry.actor_type;
}

// ---------------------------------------------------------------------------
// TimelineEntry
// ---------------------------------------------------------------------------

function TimelineEntry({
  entry,
  isLast,
}: {
  entry: AiTimelineEntry;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const diff = entry.diff_summary as {
    bytes_added?: number;
    bytes_removed?: number;
    body_changed?: boolean;
    title_changed?: boolean;
  } | null;

  const originBadgeClass =
    ORIGIN_BADGE_CLASS[entry.change_origin] ?? undefined;

  return (
    <div className="flex gap-3">
      {/* Timeline rail */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2",
            entry.change_origin === "generated" ||
              entry.change_origin === "proposal_approved"
              ? "border-purple-500 bg-purple-100 dark:border-purple-400 dark:bg-purple-900/40"
              : "border-muted-foreground/40 bg-muted"
          )}
          aria-hidden="true"
        />
        {!isLast && (
          <div className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
        )}
      </div>

      {/* Content */}
      <div className={cn("min-w-0 flex-1 pb-4", isLast && "pb-0")}>
        {/* Actor + time */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {entry.actor_type === "connection" || entry.actor_type === "system" ? (
            <Bot
              className="h-3 w-3 shrink-0 text-muted-foreground/60"
              aria-hidden="true"
            />
          ) : (
            <Clock
              className="h-3 w-3 shrink-0 text-muted-foreground/60"
              aria-hidden="true"
            />
          )}
          <span className="text-[11px] text-foreground/70">
            {actorLabel(entry)}
          </span>
          <span className="text-[10px] text-muted-foreground/50">·</span>
          <span className="text-[10px] text-muted-foreground/60">
            {timeAgo(entry.created_at)}
          </span>
        </div>

        {/* Origin badge */}
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1.5 text-[9px] font-normal",
              originBadgeClass
            )}
          >
            {entry.change_origin === "proposal_approved" ? (
              <CheckCircle2 className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
            ) : (
              <Bot className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
            )}
            {ORIGIN_LABEL[entry.change_origin] ?? entry.change_origin}
          </Badge>

          {/* Byte delta */}
          {diff && (
            <>
              {(diff.bytes_added ?? 0) > 0 && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                  +{diff.bytes_added}B
                </span>
              )}
              {(diff.bytes_removed ?? 0) > 0 && (
                <span className="text-[10px] text-rose-600 dark:text-rose-400">
                  -{diff.bytes_removed}B
                </span>
              )}
            </>
          )}
        </div>

        {/* Expand to see content snapshot */}
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronUp className="h-2.5 w-2.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
          )}
          {expanded ? "Hide snapshot" : "View snapshot"}
        </button>

        {expanded && (
          <div className="mt-1.5 rounded border border-border bg-muted/30 px-2.5 py-2">
            <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-foreground/70">
              {entry.markdown_content.length > 400
                ? entry.markdown_content.slice(0, 400) + "\n…"
                : entry.markdown_content || "(empty)"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NoteAiTimeline
// ---------------------------------------------------------------------------

export function NoteAiTimeline({ entries }: NoteAiTimelineProps) {
  const [showAll, setShowAll] = useState(false);

  if (entries.length === 0) {
    return (
      <div className="py-4 text-center">
        <Bot
          className="mx-auto mb-2 h-6 w-6 text-muted-foreground/30"
          aria-hidden="true"
        />
        <p className="text-xs text-muted-foreground">
          No AI actions on this note yet
        </p>
      </div>
    );
  }

  const visible = showAll ? entries : entries.slice(0, COLLAPSED_COUNT);
  const hasMore = entries.length > COLLAPSED_COUNT;

  return (
    <div>
      <div className="flex flex-col">
        {visible.map((entry, i) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            isLast={i === visible.length - 1 && (!hasMore || showAll)}
          />
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((x) => !x)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAll ? (
            <ChevronUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          )}
          {showAll
            ? "Show less"
            : `Show ${entries.length - COLLAPSED_COUNT} more`}
        </button>
      )}
    </div>
  );
}
