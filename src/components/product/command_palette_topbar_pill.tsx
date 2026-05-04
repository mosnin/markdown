"use client";

import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Quiet pill-shaped affordance that lives in the topbar between the
 * breadcrumbs (left) and the toolbar (right). It is the obvious entry
 * point to the command palette: a single click summons it, while the
 * keyboard hint reminds users of the ⌘K binding.
 *
 * Rendered in two places by the app layout — once inside a desktop-only
 * slot (`variant="pill"`) and once inside a mobile-only slot
 * (`variant="icon"`) — so the topbar can dedicate the whole middle
 * column to the pill on desktop and collapse to a single icon on small
 * screens without an extra tap-row.
 *
 * Summoning the palette is decoupled from this component: we dispatch
 * the `command-palette:open` window event, which `CommandPaletteProvider`
 * listens for. That keeps the topbar render path free of palette state
 * and avoids the double-mounting problem when both the layout and the
 * provider live in the same tree.
 */
export function CommandPaletteTopbarPill({
  variant = "pill",
}: {
  variant?: "pill" | "icon";
}) {
  function summon() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("command-palette:open"));
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={summon}
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        )}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={summon}
      aria-label="Open command palette"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "inline-flex items-center gap-2",
        "h-7 max-w-md w-full rounded-full border border-border bg-card px-3",
        "text-[12.5px] text-muted-foreground transition-colors",
        "hover:border-border-strong hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left truncate">Search</span>
      <span className="text-muted-foreground/50">·</span>
      <kbd className="inline-flex h-5 shrink-0 items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        ⌘K
      </kbd>
    </button>
  );
}
