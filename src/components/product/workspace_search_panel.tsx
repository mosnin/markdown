"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { FileText, BookOpen, Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type NoteSearchResult } from "@/server/services/search_service";
import { searchNotesAction } from "@/app/app/boxes/actions";

interface WorkspaceSearchPanelProps {
  boxes: Array<{ id: string; name: string }>;
}

function noteIcon(kind: string) {
  if (kind === "guide") return BookOpen;
  if (kind === "bundle") return Package;
  return FileText;
}

/**
 * Workspace-level search panel.
 *
 * Lets the user pick a box and search notes within it using Postgres FTS.
 * Search is box-scoped — cross-box search is out of scope for V1.
 */
export function WorkspaceSearchPanel({ boxes }: WorkspaceSearchPanelProps) {
  const [selectedBoxId, setSelectedBoxId] = useState(boxes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedBox = boxes.find((b) => b.id === selectedBoxId);

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim() || !selectedBoxId) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await searchNotesAction(selectedBoxId, q);
        if (res.ok) {
          setResults(res.data);
          setSearched(true);
        }
      });
    }, 300);
  }

  function handleBoxChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedBoxId(e.target.value);
    setResults([]);
    setSearched(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Box selector + search input */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={selectedBoxId}
          onChange={handleBoxChange}
          aria-label="Select box to search"
          className={cn(
            "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
            "sm:w-48 shrink-0"
          )}
        >
          {boxes.map((box) => (
            <option key={box.id} value={box.id}>
              {box.name}
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={handleQueryChange}
            placeholder="Search notes…"
            aria-label="Search query"
            className="pl-9"
          />
        </div>
      </div>

      {/* Results */}
      {isPending && (
        <p className="text-xs text-muted-foreground">Searching…</p>
      )}

      {!isPending && searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No notes found for &ldquo;{query}&rdquo;{selectedBox ? ` in ${selectedBox.name}` : ""}.
        </p>
      )}

      {!isPending && results.length > 0 && (
        <ul className="flex flex-col gap-1.5 list-none" role="list">
          {results.map((note) => {
            const Icon = noteIcon(note.kind);
            return (
              <li key={note.id}>
                <Link
                  href={`/app/notes/${note.id}`}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3",
                    "text-sm transition-fast hover:border-ring/40 hover:shadow-sm"
                  )}
                >
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{note.title}</p>
                    {note.summary && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {note.summary}
                      </p>
                    )}
                    {note.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {note.tags.slice(0, 4).map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[10px] font-normal px-1.5 py-0"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!searched && !isPending && query === "" && selectedBox && (
        <p className="text-xs text-muted-foreground">
          Type to search notes in <span className="font-medium">{selectedBox.name}</span>.
          Or{" "}
          <Link
            href={`/app/boxes/${selectedBox.id}`}
            className="underline underline-offset-2 hover:text-foreground transition-fast"
          >
            open the box
          </Link>{" "}
          to browse its full content.
        </p>
      )}
    </div>
  );
}
