"use client";

import { useState } from "react";
import Link from "next/link";
import { Box, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface BoxListProps {
  boxes: BoxType[];
}

export function BoxList({ boxes }: BoxListProps) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? boxes.filter(
        (b) =>
          b.name.toLowerCase().includes(query.toLowerCase()) ||
          (b.description ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : boxes;

  return (
    <div className="flex flex-col gap-3">
      {/* Filter input — only render when there are boxes */}
      {boxes.length > 0 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter boxes…"
            className="h-9 pl-9 pr-9 text-sm"
            aria-label="Filter boxes"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className={cn(
                "absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5",
                "text-muted-foreground hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No boxes match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card overflow-hidden shadow-xs">
          {filtered.map((box) => (
            <Link
              key={box.id}
              href={`/app/boxes/${box.id}`}
              className={cn(
                "group flex items-center gap-3 px-4 py-3.5",
                "transition-fast hover:bg-accent/30",
                "focus-visible:outline-none focus-visible:bg-accent/40"
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground transition-fast">
                <Box className="h-4 w-4" aria-hidden="true" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">
                  {box.name}
                </p>
                {box.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground truncate">
                    {box.description}
                  </p>
                )}
              </div>

              <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                {formatDate(box.updated_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
