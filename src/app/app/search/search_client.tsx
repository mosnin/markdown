"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Bot,
  FileText,
  Folder,
  Package,
  Search as SearchIcon,
  Loader2,
  File,
  Zap,
  Box as BoxIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  searchWorkspaceAction,
  type SearchActionResult,
} from "./actions";
import {
  type WorkspaceSearchHit,
  type WorkspaceSearchObjectType,
} from "@/server/services/workspace_search_service";

/**
 * Workspace search client.
 *
 * Real search UI, production-grade:
 *   * Fast debounced server action calls (180ms)
 *   * Cmd/Ctrl+K jumps focus to the input from anywhere on the page
 *   * ↑/↓ navigates results, Enter opens the highlighted hit
 *   * Empty / loading / error / no-results states are all explicit
 *   * Grouped result rendering by object type so scanning is easy
 *
 * The search itself runs through searchWorkspaceAction, which in turn
 * calls searchWorkspace() — the cross-type service that covers notes,
 * files, skills, agents, folders, and boxes. See
 * src/server/services/workspace_search_service.ts.
 */

const typeMeta: Record<
  WorkspaceSearchObjectType,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  note: { label: "Note", Icon: FileText },
  file: { label: "File", Icon: File },
  skill: { label: "Skill", Icon: Zap },
  agent: { label: "Agent", Icon: Bot },
  folder: { label: "Folder", Icon: Folder },
  box: { label: "Box", Icon: BoxIcon },
};

export function WorkspaceSearchClient({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<WorkspaceSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [highlighted, setHighlighted] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input on mount and on Cmd/Ctrl+K.
  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search on query change. Only schedules a fetch when the
  // query is non-empty; the "clear on empty" branch is handled
  // synchronously in the onChange handler (below) to avoid a
  // setState-in-effect cascade.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const t = window.setTimeout(() => {
      startTransition(async () => {
        const res: SearchActionResult = await searchWorkspaceAction(q);
        setHasSearched(true);
        if (res.ok) {
          setHits(res.data);
          setError(null);
          setHighlighted(0);
        } else {
          setHits([]);
          setError(res.error);
        }
      });
    }, 180);
    return () => window.clearTimeout(t);
  }, [query]);

  function onQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setHits([]);
      setError(null);
      setHasSearched(false);
    }
  }

  // Keyboard navigation inside the results list.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[highlighted];
      if (hit) window.location.assign(hit.href);
    }
  }

  const grouped = useMemo(() => {
    const order: WorkspaceSearchObjectType[] = [
      "note",
      "file",
      "skill",
      "agent",
      "folder",
      "box",
    ];
    const bucket = new Map<WorkspaceSearchObjectType, WorkspaceSearchHit[]>();
    for (const h of hits) {
      const arr = bucket.get(h.objectType) ?? [];
      arr.push(h);
      bucket.set(h.objectType, arr);
    }
    return order
      .map((t) => ({ type: t, items: bucket.get(t) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [hits]);

  return (
    <div className="space-y-5">
      {/* Search field */}
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search notes, files, skills, agents, folders, and boxes…"
          className="h-11 pl-10 pr-28 text-base"
          autoComplete="off"
          aria-label="Search workspace"
        />
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Searching" />
          ) : (
            <>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">⌘</kbd>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">K</kbd>
            </>
          )}
        </div>
      </div>

      {/* Helper row */}
      <p className="text-xs text-muted-foreground">
        Search runs across everything you can access in this workspace. Use
        <kbd className="mx-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↑</kbd>
        and
        <kbd className="mx-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↓</kbd>
        to move between results,
        <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
        to open one.
      </p>

      {/* States */}
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {!query.trim() ? (
        <EmptyPrompt />
      ) : pending && !hasSearched ? (
        <p className="px-1 text-sm text-muted-foreground">Searching…</p>
      ) : hits.length === 0 && hasSearched ? (
        <NoResults query={query} />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ type, items }) => (
            <section key={type} aria-label={`${typeMeta[type].label} results`}>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {typeMeta[type].label}
                <span className="ml-2 text-[10px] font-normal opacity-70">
                  {items.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-1.5 list-none">
                {items.map((hit) => {
                  const globalIndex = hits.indexOf(hit);
                  const isActive = globalIndex === highlighted;
                  return (
                    <li key={`${hit.objectType}:${hit.id}`}>
                      <HitRow hit={hit} active={isActive} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function HitRow({
  hit,
  active,
}: {
  hit: WorkspaceSearchHit;
  active: boolean;
}) {
  const meta = typeMeta[hit.objectType];
  const Icon = meta.Icon;
  return (
    <Link
      href={hit.href}
      className={cn(
        "group flex items-start gap-3 rounded-lg border px-4 py-3 transition-fast",
        "hover:border-ring/50 hover:bg-accent/40",
        active
          ? "border-ring bg-accent/50"
          : "border-border bg-card"
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {hit.title}
          </p>
          {hit.status && hit.status !== "active" && (
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal capitalize">
              {hit.status}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {buildBreadcrumb(hit)}
        </p>
        {hit.snippet && (
          <p className="mt-1.5 text-xs text-muted-foreground/90 line-clamp-2">
            {hit.snippet}
          </p>
        )}
      </div>
      <Badge
        variant="secondary"
        className="shrink-0 text-[10px] font-normal capitalize"
      >
        {meta.label}
      </Badge>
    </Link>
  );
}

function buildBreadcrumb(hit: WorkspaceSearchHit): string {
  const parts: string[] = [];
  if (hit.boxName && hit.objectType !== "box") parts.push(hit.boxName);
  if (hit.path && hit.objectType !== "box") parts.push(hit.path);
  if (parts.length === 0) return hit.objectType === "box" ? "Workspace box" : "—";
  return parts.join(" · ");
}

function EmptyPrompt() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      <SearchIcon className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">Start typing to search your workspace</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Search looks at titles, file names, descriptions, markdown
        content, skill bodies, agent prompts, and more — across boxes,
        folders, notes, files, skills, and agents.
      </p>
      <div className="mx-auto mt-6 flex max-w-md flex-wrap items-center justify-center gap-1.5">
        {(["Note", "File", "Skill", "Agent", "Folder", "Box"] as const).map((l) => {
          const k = l.toLowerCase() as WorkspaceSearchObjectType;
          const Icon = typeMeta[k].Icon;
          return (
            <span
              key={l}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground"
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {l}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-10 text-center">
      <Package className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">
        No matches for &ldquo;{query}&rdquo;
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Try a shorter term, or browse your boxes from the sidebar. Trashed
        items are intentionally excluded.
      </p>
    </div>
  );
}
