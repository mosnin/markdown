"use client";

import { useState, useTransition, useRef } from "react";
import { Search, FileText } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { type NoteSearchResult } from "@/server/services/search_service";
import { searchNotesAction } from "@/app/app/boxes/actions";

interface BoxSearchPanelProps {
  boxId: string;
}

/**
 * Full-text search panel for a box.
 *
 * Uses Postgres FTS via the search_notes RPC (weighted: title/tags A,
 * summary B, body C). Results update as the user types (debounced 300ms).
 */
export function BoxSearchPanel({ boxId }: BoxSearchPanelProps) {
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
      {/* Search input */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search notes…"
          value={query}
          onChange={handleChange}
          className="pl-9"
          autoFocus
        />
      </div>

      {/* Status / results */}
      {!query.trim() && (
        <p className="text-center text-sm text-muted-foreground">
          Type to search notes in this box.
        </p>
      )}

      {query.trim() && isPending && (
        <p className="text-center text-sm text-muted-foreground">Searching…</p>
      )}

      {query.trim() && !isPending && searched && results.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          No notes found for &ldquo;{query}&rdquo;.
        </p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          {results.map((note) => (
            <Link
              key={note.id}
              href={`/app/notes/${note.id}`}
              className="flex flex-col gap-1 rounded-md border border-border bg-card p-3 transition-fast hover:border-ring hover:shadow-sm"
            >
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-sm font-medium text-foreground leading-snug">
                  {note.title}
                </span>
                {note.kind !== "note" && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px] font-normal capitalize"
                  >
                    {note.kind}
                  </Badge>
                )}
              </div>
              {note.summary && (
                <p className="line-clamp-2 pl-5 text-xs text-muted-foreground">
                  {note.summary}
                </p>
              )}
              {note.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-5">
                  {note.tags.slice(0, 4).map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[10px] font-normal"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
