"use client";

import Link from "next/link";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalSearch } from "@/hooks/use_local_search";

interface LocalSearchResultsProps {
  query: string;
  /** Map from noteId to note metadata for rendering result rows */
  noteIndex: Record<string, { title: string; boxId: string }>;
  workspaceNoteIds?: string[];
}

/**
 * Renders a "Local (on-device)" section of search results beneath the
 * server-side results on the search page.
 *
 * Always loaded with `ssr: false` by its parent — do not add dynamic() here.
 * Fails silently: when status is "error" or hits are empty, renders nothing
 * so the server results remain unaffected.
 */
export function LocalSearchResults({
  query,
  noteIndex,
  workspaceNoteIds,
}: LocalSearchResultsProps) {
  const { hits, status } = useLocalSearch(query, workspaceNoteIds);

  // Nothing to show for empty query, idle state, or errors (fail silently).
  if (!query.trim() || status === "idle" || status === "error") {
    return null;
  }

  // Skeleton / loading state — one animated placeholder row.
  if (status === "loading") {
    return (
      <section aria-label="Local search loading" aria-busy="true">
        <SectionHeader />
        <div className="flex flex-col gap-1.5">
          <div className="h-10 animate-pulse rounded-lg border border-border bg-muted/40" />
        </div>
      </section>
    );
  }

  // Ready but no hits — render nothing.
  if (hits.length === 0) {
    return null;
  }

  // Render up to 12 hits, skipping any noteId not present in noteIndex.
  const visibleHits = hits
    .filter((hit) => noteIndex[hit.noteId] !== undefined)
    .slice(0, 12);

  if (visibleHits.length === 0) {
    return null;
  }

  return (
    <section aria-label="Local on-device search results">
      <SectionHeader />
      <ul className="flex flex-col gap-1.5 list-none">
        {visibleHits.map((hit) => {
          const meta = noteIndex[hit.noteId];
          // Already filtered above, but keep the guard for type safety.
          if (!meta) return null;
          return (
            <li key={hit.noteId}>
              <Link
                href={`/app/notes/${hit.noteId}`}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5",
                  "transition-colors hover:border-ring/50 hover:bg-accent/40"
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {meta.title}
                </span>
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
                  {(hit.score * 100).toFixed(0)}% match
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Shared section header with Cpu icon and "Local (on-device)" label. */
function SectionHeader() {
  return (
    <h2 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
      Local (on-device)
    </h2>
  );
}
