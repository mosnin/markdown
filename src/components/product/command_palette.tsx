"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Box,
  Home,
  LayoutDashboard,
  Network,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  searchEntitiesAction,
  type EntitySearchHit,
} from "@/app/app/entities/search_actions";

interface CommandItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href?: string;
  action?: () => void;
  category: string;
  keywords?: string[];
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Keyboard-driven command palette. Invoked via Cmd/Ctrl+K by the
 * CommandPaletteProvider that mounts this component in the app layout.
 *
 * Navigation-first: every item either routes to an app destination or
 * fires a local action. Matches are filtered by substring on label or
 * keyword (case-insensitive) and grouped by category for display.
 *
 * Entity search: a debounced query against the workspace knowledge graph
 * (via searchEntitiesAction) appends an "Entities" section below the
 * commands. Entities are included in keyboard navigation by folding them
 * into a single flat activation list [commands..., entities...].
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [entityHits, setEntityHits] = useState<EntitySearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: "nav-home",
        label: "Go to Home (conversation)",
        icon: Home,
        href: "/app",
        category: "Navigate",
      },
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        icon: LayoutDashboard,
        href: "/app/dashboard",
        category: "Navigate",
      },
      {
        id: "nav-search",
        label: "Open Search",
        icon: Search,
        href: "/app/search",
        category: "Navigate",
        keywords: ["find", "notes"],
      },
      {
        id: "nav-workspaces",
        label: "Go to Workspaces",
        icon: Box,
        href: "/app/workspaces",
        category: "Navigate",
        keywords: ["boxes"],
      },
      {
        id: "nav-pog",
        label: "Open Pog Agent",
        icon: Bot,
        href: "/app/workspace_operator",
        category: "Navigate",
        keywords: ["ask", "assistant"],
      },
      {
        id: "nav-settings",
        label: "Open Settings",
        icon: Settings,
        href: "/app/settings",
        category: "Navigate",
      },
      {
        id: "nav-capture",
        label: "Quick Capture",
        icon: Plus,
        href: "/capture",
        category: "Create",
        keywords: ["note", "new"],
      },
    ],
    [],
  );

  // Filter by query (case-insensitive substring in label or keywords)
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
    );
  }, [commands, query]);

  // Debounced entity search. Skip for very short queries to avoid chatty RPCs
  // on the first keystroke. Clears hits when the query is empty.
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setEntityHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      const result = await searchEntitiesAction(query, 8);
      if (result.ok) setEntityHits(result.data);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setEntityHits([]);
      // Focus the input after the dialog finishes animating in.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Unified activation list. Commands first, then entity hits — this is the
  // single source of truth for keyboard navigation (activeIndex ranges over
  // this). The rendered markup below mirrors the same order.
  type ActivationItem =
    | { kind: "command"; command: CommandItem }
    | { kind: "entity"; hit: EntitySearchHit };

  const items: ActivationItem[] = useMemo(
    () => [
      ...filtered.map((c) => ({ kind: "command" as const, command: c })),
      ...entityHits.map((h) => ({ kind: "entity" as const, hit: h })),
    ],
    [filtered, entityHits],
  );

  // Keep activeIndex in bounds when results change
  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(0);
  }, [items.length, activeIndex]);

  function executeCommand(cmd: CommandItem) {
    onOpenChange(false);
    if (cmd.action) cmd.action();
    else if (cmd.href) router.push(cmd.href);
  }

  function executeEntity(hit: EntitySearchHit) {
    onOpenChange(false);
    router.push(`/app/entities/${hit.id}`);
  }

  function activateItem(item: ActivationItem) {
    if (item.kind === "command") executeCommand(item.command);
    else executeEntity(item.hit);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) activateItem(item);
    }
  }

  // Group commands by category for display, preserving first-seen order.
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const c of filtered) {
      const existing = map.get(c.category);
      if (existing) existing.push(c);
      else map.set(c.category, [c]);
    }
    return map;
  }, [filtered]);

  const hasResults = items.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
        </DialogHeader>
        <div className="border-b border-border px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            aria-label="Command palette input"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {!hasResults ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No results
            </p>
          ) : (
            <>
              {Array.from(grouped.entries()).map(([category, categoryItems]) => (
                <div key={category} className="mb-1">
                  <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    {category}
                  </p>
                  {categoryItems.map((cmd) => {
                    const flatIndex = filtered.indexOf(cmd);
                    const Icon = cmd.icon;
                    const isActive = flatIndex === activeIndex;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onClick={() => executeCommand(cmd)}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground",
                        )}
                      >
                        <Icon
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span>{cmd.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {entityHits.length > 0 && (
                <div className="mb-1">
                  <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Entities
                  </p>
                  {entityHits.map((hit, entityIdx) => {
                    const flatIndex = filtered.length + entityIdx;
                    const isActive = flatIndex === activeIndex;
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => executeEntity(hit)}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground hover:bg-accent",
                        )}
                      >
                        <Network
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="flex-1 truncate">{hit.name}</span>
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {hit.entity_type}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          ·{hit.mention_count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>up/down navigate</span>
          <span>enter select</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
