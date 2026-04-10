"use client";

import { useState, useTransition, useRef } from "react";
import { BookOpen, Bot, FileText, Search } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { type NoteSearchResult } from "@/server/services/search_service";
import { searchNotesAction } from "@/app/app/boxes/actions";
import { cn } from "@/lib/utils";

interface BoxSearchPanelProps {
  boxId: string;
  /** boxes.guide_note_id — used to mark the guide note in results. */
  guideNoteId?: string | null;
}

/**
 * Full-text search panel for a box.
 *
 * Uses Postgres FTS via the search_notes RPC (weighted: title/tags A,
 * summary B, body C). Results update as the user types (debounced 300ms).
 *
 * Results show: title, path, summary snippet, kind badge, guide marker,
 * generated marker. Search is box-scoped only — no cross-box mixing.
 * Results are deterministic and ranked (exact title match → prefix → ts_rank).
 */
export function BoxSearchPanel({ boxId, guideNoteId }: BoxSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchNotesAction(boxId, q.trim());
        if (result.ok) {
          setResults(result.data);
          setSearched(true);
        }
      });
    }, 300);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Precision search
        </p>
        <p className="text-xs text-muted-foreground/70">
          Full-text search across title, tags, summary, and body.
          Results are ranked — exact title matches appear first.
        </p>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          placeholder="Search notes in this box…"
          value={query}
          onChange={handleChange}
          className="pl-9"
          autoFocus
          aria-label="Search notes"
        />
      </div>

      {/* States */}
      {!query.trim() && (
        <p className="text-center text-xs text-muted-foreground/60 py-4">
          Type to search notes in this box.
        </p>
      )}

      {query.trim() && isPending && (
        <p className="text-center text-xs text-muted-foreground py-4">Searching…</p>
      )}

      {query.trim() && !isPending && searched && results.length === 0 && (
        <p className="text-center text-xs text-muted-foreground py-4">
          No notes found for &ldquo;{query}&rdquo;.
        </p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="flex flex-col gap-1.5" role="list" aria-label="Search results">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          {results.map((note) => (
            <SearchResultCard
              key={note.id}
              note={note}
              isGuide={note.id === guideNoteId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Search result card ───────────────────────────────────────────────────────

function noteIcon(kind: string) {
  if (kind === "guide") return BookOpen;
  return FileText;
}

function SearchResultCard({
  note,
  isGuide,
}: {
  note: NoteSearchResult;
  isGuide: boolean;
}) {
  const Icon = noteIcon(note.kind);

  // Derive folder path from path_cache (everything before the last /)
  const pathParts = note.path_cache.split("/");
  const folderPath =
    pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : null;

  return (
    <Link
      href={`/app/notes/${note.id}`}
      role="listitem"
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-card p-3 transition-fast",
        "hover:border-ring/50 hover:shadow-sm",
        isGuide
          ? "border-amber-300/60 dark:border-amber-600/40"
          : "border-border"
      )}
    >
      {/* Title row */}
      <div className="flex items-start gap-2">
        {/* noteIcon() returns a stable module-level icon reference — not a new component */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            isGuide
              ? "text-amber-600 dark:text-amber-500"
              : "text-muted-foreground"
          )}
          aria-hidden="true"
        />
        <span className="flex-1 text-sm font-medium leading-snug text-foreground">
          {note.title}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {isGuide && (
            <Badge
              variant="secondary"
              className="text-[10px] font-normal text-amber-600 dark:text-amber-500"
            >
              Guide
            </Badge>
          )}
          {note.is_generated && (
            <Badge
              variant="outline"
              className="flex items-center gap-0.5 text-[10px] font-normal"
            >
              <Bot className="h-2.5 w-2.5" aria-hidden="true" />
              AI
            </Badge>
          )}
          {note.kind !== "note" && !isGuide && (
            <Badge variant="secondary" className="text-[10px] font-normal capitalize">
              {note.kind}
            </Badge>
          )}
        </div>
      </div>

      {/* Folder path */}
      {folderPath && (
        <p className="pl-5 font-mono text-[10px] text-muted-foreground/50">
          {folderPath}
        </p>
      )}

      {/* Summary snippet */}
      {note.summary && (
        <p className="line-clamp-2 pl-5 text-xs leading-relaxed text-muted-foreground">
          {note.summary}
        </p>
      )}

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-5">
          {note.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px] font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}
