"use client";

import { useState } from "react";
import Link from "next/link";
import { Link2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalSearch } from "@/hooks/use_local_search";

interface EditorRelatedPanelProps {
  noteId: string;
  noteTitle: string;
  workspaceNoteIds?: string[];
  noteIndex: Record<string, { title: string; boxId: string }>;
}

/**
 * Collapsible "Related notes" panel for the note editor.
 *
 * Uses the current note's title as the semantic query — debouncing is handled
 * inside useLocalSearch. Filters out the note being edited, keeps up to 5
 * hits with score > 0.3, and renders nothing when there are no qualifying
 * results so it never distracts the user unnecessarily.
 */
export function EditorRelatedPanel({
  noteId,
  noteTitle,
  workspaceNoteIds,
  noteIndex,
}: EditorRelatedPanelProps) {
  const [open, setOpen] = useState(false);
  const { hits, status } = useLocalSearch(noteTitle, workspaceNoteIds);

  // Build the qualifying hit list: exclude self, score threshold, top 5.
  const qualifyingHits = hits
    .filter((hit) => hit.noteId !== noteId && hit.score > 0.3)
    .slice(0, 5);

  // Don't render at all when there's nothing useful to show.
  if (
    status === "idle" ||
    status === "error" ||
    !noteTitle.trim() ||
    qualifyingHits.length === 0
  ) {
    return null;
  }

  return (
    <div className="border-t border-border">
      {/* ── Collapsed header / toggle ──────────────────────────────────────── */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex w-full items-center gap-1.5 px-4 py-2",
            "text-[11px] text-muted-foreground transition-colors",
            "hover:bg-accent/40 hover:text-foreground"
          )}
          aria-expanded={false}
          aria-label={`Show ${qualifyingHits.length} related notes`}
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {qualifyingHits.length}{" "}
            {qualifyingHits.length === 1 ? "related" : "related"}
          </span>
        </button>
      ) : (
        /* ── Expanded panel ──────────────────────────────────────────────── */
        <div className="flex flex-col gap-1 px-4 py-2">
          {/* Panel header row */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Related notes
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cn(
                "rounded p-0.5 text-muted-foreground/60 transition-colors",
                "hover:bg-accent hover:text-foreground"
              )}
              aria-label="Close related notes panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Result list */}
          <ul className="flex flex-col gap-1 list-none">
            {qualifyingHits.map((hit) => {
              const meta = noteIndex[hit.noteId];
              if (!meta) return null;
              return (
                <li key={hit.noteId}>
                  <Link
                    href={`/app/notes/${hit.noteId}`}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-1.5",
                      "transition-colors hover:bg-accent/50"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground group-hover:text-foreground">
                      {meta.title}
                    </span>
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
                      {(hit.score * 100).toFixed(0)}%
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
