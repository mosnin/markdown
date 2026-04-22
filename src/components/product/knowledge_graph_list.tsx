"use client";

import { useState } from "react";
import { Network, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EntityChip, type EntityChipType } from "@/components/product/entity_chip";

type Entity = {
  id: string;
  name: string;
  entity_type: EntityChipType;
  description: string | null;
  mention_count: number;
  last_seen_at: string;
};

const ENTITY_TYPES: EntityChipType[] = ["person", "project", "concept", "organization", "event", "decision", "other"];

export function KnowledgeGraphList({ entities }: { entities: Entity[] }) {
  const [activeType, setActiveType] = useState<EntityChipType | null>(null);
  const [query, setQuery] = useState("");

  const filtered = entities
    .filter((e) => (activeType ? e.entity_type === activeType : true))
    .filter((e) => (query.trim() ? e.name.toLowerCase().includes(query.toLowerCase()) : true));

  const counts = ENTITY_TYPES.reduce((acc, t) => {
    acc[t] = entities.filter((e) => e.entity_type === t).length;
    return acc;
  }, {} as Record<EntityChipType, number>);

  return (
    <div>
      <div className="border-b border-border bg-background/80 backdrop-blur px-6 py-3 sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <input
            type="text"
            placeholder="Search entities…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-violet-500 w-48"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mr-1">Type</span>
          {ENTITY_TYPES.filter((t) => counts[t] > 0).map((t) => (
            <button
              key={t}
              onClick={() => setActiveType(activeType === t ? null : t)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] transition-colors capitalize",
                activeType === t
                  ? "bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 border border-transparent"
              )}
            >
              {t} <span className="text-muted-foreground/60">·{counts[t]}</span>
            </button>
          ))}
          {activeType && (
            <button onClick={() => setActiveType(null)} className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-6 py-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          {filtered.length} entit{filtered.length === 1 ? "y" : "ies"}
        </p>
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center">
            <Network className="mx-auto h-6 w-6 text-muted-foreground/40 mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No entities match this filter</p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <a
                key={e.id}
                href={`/app/entities/${e.id}`}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <div className="flex items-center gap-2">
                  <EntityChip id={e.id} name={e.name} type={e.entity_type} interactive={false} />
                  <span className="ml-auto text-[10px] text-muted-foreground/60">
                    {e.mention_count} mention{e.mention_count === 1 ? "" : "s"}
                  </span>
                </div>
                {e.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{e.description}</p>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
