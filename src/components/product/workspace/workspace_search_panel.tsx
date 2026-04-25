"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { AlertCircle, Bot, BookOpen, FileText, Package, Package2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type NoteSearchResult } from "@/server/services/search_service";
import { searchNotesAction } from "@/app/app/boxes/actions";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function noteIcon(kind: string) {
  if (kind === "guide") return BookOpen;
  if (kind === "bundle") return Package;
  return FileText;
}

/** Highlight matched query terms in a text snippet. */
function HighlightedExcerpt({ text, query }: { text: string; query: string }) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (terms.length === 0) return <span>{text}</span>;

  const pattern = new RegExp(`(${terms.join("|")})`, "gi");
  const parts = text.split(pattern);

  let offset = 0;
  return (
    <>
      {parts.map((part) => {
        const key = `${query}-${part.slice(0, 10)}-${offset}`;
        offset += part.length;
        return pattern.test(part) ? (
          <strong key={key} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
    </>
  );
}

/** Format a date string as a relative or absolute label. */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffHours < 24) {
    const h = Math.floor(diffHours);
    return h <= 1 ? "just now" : `${h}h ago`;
  }
  if (diffHours < 48) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SearchSkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading search results">
      {Array.from({ length: count }).map((_, i) => (
        // skeleton row, index key is safe
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 shrink-0 rounded" />
            <Skeleton className="h-4 rounded" style={{ width: `${45 + (i % 3) * 15}%` }} />
          </div>
          <Skeleton className="ml-7 h-3 w-1/4 rounded" />
          <Skeleton className="ml-7 h-3 rounded" style={{ width: `${55 + (i % 2) * 20}%` }} />
        </div>
      ))}
    </div>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function WorkspaceSearchResultCard({
  note,
  boxName,
  query,
}: {
  note: NoteSearchResult;
  boxName: string;
  query: string;
}) {
   
  const Icon = noteIcon(note.kind);
  const dateLabel = formatDate(note.updated_at);

  return (
    <Link
      href={`/app/notes/${note.id}`}
      role="listitem"
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3",
        "transition-fast hover:border-ring/40 hover:bg-accent/30 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      )}
    >
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-fast group-hover:text-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {/* Title + date */}
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium leading-snug text-foreground">
            {note.title}
          </p>
          <time dateTime={note.updated_at} className="shrink-0 text-xs text-muted-foreground">
            {dateLabel}
          </time>
        </div>

        {/* Box breadcrumb */}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{boxName}</p>

        {/* Excerpt with highlighted match terms */}
        {note.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            <HighlightedExcerpt text={note.summary} query={query} />
          </p>
        )}

        {/* Tags + AI badge */}
        {(note.tags.length > 0 || note.is_generated) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {note.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                {tag}
              </Badge>
            ))}
            {note.is_generated && (
              <Badge variant="outline" className="flex items-center gap-0.5 px-1.5 py-0 text-[10px] font-normal">
                <Bot className="h-2.5 w-2.5" aria-hidden="true" />
                AI
              </Badge>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── WorkspaceSearchPanel ─────────────────────────────────────────────────────

interface WorkspaceSearchPanelProps {
  boxes: Array<{ id: string; name: string }>;
}

/**
 * Workspace-level search panel for /app/search.
 *
 * Prominent search input, box scoping selector, skeleton loading, highlighted
 * excerpts, no-results state, and error state. Results are grouped by box when
 * spanning multiple boxes.
 */
export function WorkspaceSearchPanel({ boxes }: WorkspaceSearchPanelProps) {
  const [selectedBoxId, setSelectedBoxId] = useState(boxes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedBox = boxes.find((b) => b.id === selectedBoxId);
  const boxMap = Object.fromEntries(boxes.map((b) => [b.id, b.name]));

  function runSearch(boxId: string, q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim() || !boxId) {
      setResults([]);
      setSearched(false);
      setSearchError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        setSearchError(null);
        const res = await searchNotesAction(boxId, q);
        if (res.ok) {
          setResults(res.data);
          setSearched(true);
        } else {
          setSearchError("Search failed. Please try again.");
          setResults([]);
          setSearched(false);
        }
      });
    }, 300);
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    runSearch(selectedBoxId, q);
  }

  function handleBoxChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newBoxId = e.target.value;
    setSelectedBoxId(newBoxId);
    setResults([]);
    setSearched(false);
    setSearchError(null);
    if (query.trim()) runSearch(newBoxId, query);
  }

  // Group results by box when spanning multiple boxes
  const boxIds = Array.from(new Set(results.map((r) => r.box_id)));
  const shouldGroup = boxes.length > 1 && boxIds.length > 1;
  const grouped = shouldGroup
    ? boxIds.map((bid) => ({
        boxId: bid,
        boxName: boxMap[bid] ?? bid,
        notes: results.filter((r) => r.box_id === bid),
      }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Search controls */}
      <div className="flex flex-col gap-3">
        {/* Prominent search input */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={handleQueryChange}
            placeholder="Search notes, boxes…"
            aria-label="Search notes"
            autoFocus
            className="h-12 rounded-lg border-border pl-11 pr-4 text-base shadow-sm focus:border-ring"
          />
        </div>

        {/* Box scoping row */}
        {boxes.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">In box:</span>
            <select
              value={selectedBoxId}
              onChange={handleBoxChange}
              aria-label="Select box to search"
              className={cn(
                "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
              )}
            >
              {boxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Idle / empty prompt */}
      {!query.trim() && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Search className="h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {selectedBox
              ? `Type to search notes in ${selectedBox.name}.`
              : "Type to search notes across your workspace."}
          </p>
          {selectedBox && (
            <Link
              href={`/app/boxes/${selectedBox.id}`}
              className="text-xs text-muted-foreground underline underline-offset-2 transition-fast hover:text-foreground"
            >
              Browse {selectedBox.name}
            </Link>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {query.trim() && isPending && <SearchSkeletonRows count={6} />}

      {/* Error state */}
      {searchError && !isPending && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{searchError}</p>
        </div>
      )}

      {/* No results */}
      {query.trim() && !isPending && searched && results.length === 0 && !searchError && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            No results for &ldquo;{query}&rdquo;
          </p>
          <p className="text-xs text-muted-foreground">
            Try different keywords, or check your spelling.
          </p>
        </div>
      )}

      {/* Results */}
      {!isPending && results.length > 0 && (
        <div>
          <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>

          {shouldGroup ? (
            /* Grouped by box */
            <div className="flex flex-col gap-4" role="list" aria-label="Search results grouped by box">
              {grouped.map(({ boxId, boxName, notes }) => (
                <div key={boxId} role="group" aria-label={`Results in ${boxName}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <Package2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {boxName}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      {notes.length} result{notes.length !== 1 ? "s" : ""}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {notes.map((note) => (
                      <WorkspaceSearchResultCard
                        key={note.id}
                        note={note}
                        boxName={boxName}
                        query={query}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Flat list */
            <div className="flex flex-col gap-1.5" role="list" aria-label="Search results">
              {results.map((note) => (
                <WorkspaceSearchResultCard
                  key={note.id}
                  note={note}
                  boxName={boxMap[note.box_id] ?? selectedBox?.name ?? ""}
                  query={query}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
