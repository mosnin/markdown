"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const LocalSearchResults = dynamic(
  () =>
    import("@/components/product/local_search_results").then(
      (m) => m.LocalSearchResults
    ),
  { ssr: false }
);
import {
  searchWorkspaceAction,
  hybridSearchAction,
  type SearchActionResult,
  type HybridSearchActionResult,
} from "./actions";
import {
  type WorkspaceSearchHit,
  type WorkspaceSearchObjectType,
} from "@/server/services/workspace_search_service";
import {
  type HybridMatchType,
  type HybridSearchResult,
} from "@/server/services/embedding_service";

/**
 * Workspace search client.
 *
 * Real search UI, production-grade:
 *   * Fast debounced server action calls (180ms)
 *   * Cmd/Ctrl+K jumps focus to the input from anywhere on the page
 *   * Arrow up/down navigates results, Enter opens the highlighted hit
 *   * Empty / loading / error / no-results states are all explicit
 *   * Grouped result rendering by object type so scanning is easy
 *   * Semantic mode: vector-based search by meaning using embeddings
 *
 * The search itself runs through searchWorkspaceAction (keyword) or
 * semanticSearchAction (semantic), which in turn call the respective
 * service layers.
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

type SearchMode = "keyword" | "semantic";

export function WorkspaceSearchClient({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [hits, setHits] = useState<WorkspaceSearchHit[]>([]);
  const [semanticHits, setSemanticHits] = useState<HybridSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [highlighted, setHighlighted] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input on mount. Cmd/Ctrl+K is owned by the global
  // CommandPalette (see CommandPaletteProvider), so we don't bind it here —
  // it previously fired this focus handler and opened the palette together.
  useEffect(() => {
    inputRef.current?.focus();
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
        if (mode === "semantic") {
          const res: HybridSearchActionResult = await hybridSearchAction(q);
          setHasSearched(true);
          if (res.ok) {
            setSemanticHits(res.data);
            setError(null);
            setHighlighted(0);
          } else {
            setSemanticHits([]);
            setError(res.error);
          }
        } else {
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
        }
      });
    }, 180);
    return () => window.clearTimeout(t);
  }, [query, mode]);

  function onQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setHits([]);
      setSemanticHits([]);
      setError(null);
      setHasSearched(false);
    }
  }

  function onModeChange(newMode: SearchMode) {
    setMode(newMode);
    setHits([]);
    setSemanticHits([]);
    setHasSearched(false);
    setHighlighted(0);
  }

  const activeResultCount = mode === "semantic" ? semanticHits.length : hits.length;

  // Keyboard navigation inside the results list.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (activeResultCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % activeResultCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + activeResultCount) % activeResultCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "semantic") {
        const hit = semanticHits[highlighted];
        if (hit) window.location.assign(`/app/notes/${hit.noteId}`);
      } else {
        const hit = hits[highlighted];
        if (hit) window.location.assign(hit.href);
      }
    }
  }

  // Build a noteIndex from server hits so LocalSearchResults can show titles.
  // Partial coverage is fine — local-only hits fall back to "Note" as label.
  const noteIndex = useMemo(() => {
    const idx: Record<string, { title: string; boxId: string }> = {};
    for (const h of hits) {
      if (h.objectType === "note") {
        idx[h.id] = { title: h.title, boxId: (h as { boxId?: string }).boxId ?? "" };
      }
    }
    for (const h of semanticHits) {
      idx[h.noteId] = { title: h.title, boxId: "" };
    }
    return idx;
  }, [hits, semanticHits]);

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
          placeholder={
            mode === "semantic"
              ? "Describe what you're looking for\u2026"
              : "Search notes, files, skills, agents, folders, and boxes\u2026"
          }
          className="h-11 pl-10 pr-28 text-base"
          autoComplete="off"
          aria-label="Search workspace"
        />
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Searching" />
          ) : (
            <>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">&#8984;</kbd>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">K</kbd>
            </>
          )}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onModeChange("keyword")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "keyword"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <SearchIcon className="h-3 w-3" aria-hidden="true" />
          Keyword
        </button>
        <button
          type="button"
          onClick={() => onModeChange("semantic")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "semantic"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Semantic
        </button>
      </div>

      {/* Helper row */}
      <p className="text-xs text-muted-foreground">
        {mode === "semantic" ? (
          <>
            Semantic search finds notes by meaning using vector embeddings.
            Results are ranked by similarity.
          </>
        ) : (
          <>
            Search runs across everything you can access in this workspace. Use
            <kbd className="mx-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">&#8593;</kbd>
            and
            <kbd className="mx-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">&#8595;</kbd>
            to move between results,
            <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
            to open one.
          </>
        )}
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
        <p className="px-1 text-sm text-muted-foreground">Searching&#8230;</p>
      ) : mode === "semantic" ? (
        semanticHits.length === 0 && hasSearched ? (
          <NoResults query={query} />
        ) : (
          <div className="space-y-6">
            <section aria-label="Semantic search results">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Notes by similarity
                <span className="ml-2 text-[10px] font-normal opacity-70">
                  {semanticHits.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-1.5 list-none">
                {semanticHits.map((hit, idx) => (
                  <li key={hit.noteId}>
                    <SemanticHitRow hit={hit} active={idx === highlighted} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )
      ) : hits.length === 0 && hasSearched ? (
        <>
          <NoResults query={query} />
          <LocalSearchResults query={query} noteIndex={noteIndex} />
        </>
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
          <LocalSearchResults query={query} noteIndex={noteIndex} />
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

/**
 * Visual metadata for each hybrid match type. Rendered as a compact
 * badge on each semantic/hybrid result so users can see whether a hit
 * came from the vector index, keyword FTS, or both.
 */
const MATCH_TYPE_META: Record<
  HybridMatchType,
  { label: string; variant: "secondary" | "outline" | "info" }
> = {
  semantic: { label: "Semantic", variant: "info" },
  keyword: { label: "Keyword", variant: "outline" },
  both: { label: "Hybrid", variant: "secondary" },
};

function MatchTypeBadge({ matchType }: { matchType: HybridMatchType }) {
  const meta = MATCH_TYPE_META[matchType];
  return (
    <Badge
      variant={meta.variant}
      className="shrink-0 text-[10px] font-normal"
      aria-label={`Match type: ${meta.label}`}
    >
      <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

function SemanticHitRow({
  hit,
  active,
}: {
  hit: HybridSearchResult;
  active: boolean;
}) {
  const similarity = Math.round(hit.similarity * 100);
  return (
    <Link
      href={`/app/notes/${hit.noteId}`}
      className={cn(
        "group flex items-start gap-3 rounded-lg border px-4 py-3 transition-fast",
        "hover:border-ring/50 hover:bg-accent/40",
        active
          ? "border-ring bg-accent/50"
          : "border-border bg-card"
      )}
    >
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {hit.title}
          </p>
          {hit.matchType !== "keyword" && similarity > 0 && (
            <Badge
              variant="outline"
              className="shrink-0 text-[10px] font-normal tabular-nums"
            >
              {similarity}% match
            </Badge>
          )}
        </div>
        {hit.snippet && (
          <p className="mt-1.5 text-xs text-muted-foreground/90 line-clamp-2">
            {hit.snippet}
          </p>
        )}
      </div>
      <MatchTypeBadge matchType={hit.matchType} />
    </Link>
  );
}

function buildBreadcrumb(hit: WorkspaceSearchHit): string {
  const parts: string[] = [];
  if (hit.boxName && hit.objectType !== "box") parts.push(hit.boxName);
  if (hit.path && hit.objectType !== "box") parts.push(hit.path);
  if (parts.length === 0) return hit.objectType === "box" ? "Workspace box" : "\u2014";
  return parts.join(" \u00B7 ");
}

function EmptyPrompt() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      <SearchIcon className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">Start typing to search your workspace</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Search looks at titles, file names, descriptions, markdown
        content, skill bodies, agent prompts, and more &mdash; across boxes,
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
