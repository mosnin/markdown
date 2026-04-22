"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Merge, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { mergeEntitiesAction, listMergeCandidatesAction } from "@/app/app/entities/merge_actions";
import { EntityChip, type EntityChipType } from "@/components/product/entity_chip";

type Candidate = { id: string; name: string; entity_type: string; mention_count: number };

interface EntityMergeDialogProps {
  sourceEntity: { id: string; name: string; entity_type: EntityChipType };
}

export function EntityMergeDialog({ sourceEntity }: EntityMergeDialogProps) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await listMergeCandidatesAction(sourceEntity.id);
      if (cancelled) return;
      if (result.ok) setCandidates(result.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceEntity.id]);

  const filtered = query.trim()
    ? candidates.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : candidates;

  function handleMerge() {
    if (!selectedTargetId) return;
    setError(null);
    startTransition(async () => {
      const result = await mergeEntitiesAction(sourceEntity.id, selectedTargetId);
      if (result.ok) {
        setOpen(false);
        router.push(`/app/entities/${selectedTargetId}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
      >
        <Merge className="h-3.5 w-3.5" aria-hidden="true" />
        Merge into…
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold text-foreground">Merge entity</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick a target entity. Mentions and connections from <span className="font-medium text-foreground">{sourceEntity.name}</span> will be moved to the target.
              </p>
            </div>

            <div className="border-b border-border px-5 py-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search entities…"
                  className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto px-5 py-3 space-y-1">
              {loading ? (
                <div className="text-xs text-muted-foreground text-center py-8">Loading candidates…</div>
              ) : filtered.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">No matching entities</div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedTargetId(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                      selectedTargetId === c.id
                        ? "border-violet-500/50 bg-violet-500/10"
                        : "border-transparent hover:bg-accent/40"
                    )}
                  >
                    <EntityChip id={c.id} name={c.name} type={c.entity_type as EntityChipType} mentionCount={c.mention_count} interactive={false} />
                  </button>
                ))
              )}
            </div>

            {error && <p className="px-5 text-xs text-red-500">{error}</p>}

            <div className="border-t border-border px-5 py-3 flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!selectedTargetId || isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
