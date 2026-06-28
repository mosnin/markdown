"use client";

/**
 * NoteContextTabs
 *
 * The right "Note context" panel's tab switcher, rebuilt as a soft segmented
 * control (rounded-full track + animated rounded-full active pill) instead of
 * the old underlined sharp tabs.
 *
 * The three panels are passed in as pre-rendered `ReactNode`s from the server
 * component (so their own data-fetching server/client boundaries stay intact);
 * this component only owns the active-tab state and cross-fades between them.
 *
 * Switching is pure client state — no navigation — but the panel still honours
 * `?tab=…` deep links (e.g. the header's "Version history" / "Comments"
 * shortcuts) by syncing to `defaultTab` whenever it changes.
 */

import { useEffect, useState, type ReactNode } from "react";
import * as m from "motion/react-m";
import { LayoutGroup, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type NoteContextTab = "context" | "ai" | "more";

interface NoteContextTabsProps {
  defaultTab: NoteContextTab;
  pendingProposalsCount: number;
  contextPanel: ReactNode;
  aiPanel: ReactNode;
  morePanel: ReactNode;
}

const TABS: { value: NoteContextTab; label: string }[] = [
  { value: "context", label: "Context" },
  { value: "ai", label: "AI" },
  { value: "more", label: "History" },
];

export function NoteContextTabs({
  defaultTab,
  pendingProposalsCount,
  contextPanel,
  aiPanel,
  morePanel,
}: NoteContextTabsProps) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<NoteContextTab>(defaultTab);

  // Honour deep links (?tab=more from the header shortcuts): when the server
  // re-renders with a new defaultTab, follow it.
  useEffect(() => {
    setActive(defaultTab);
  }, [defaultTab]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Segmented control ── */}
      <div className="shrink-0 px-4 pb-3 pt-1">
        <LayoutGroup id="note-context-tabs">
          <div
            role="tablist"
            aria-label="Note context"
            className="flex items-center gap-1 rounded-full bg-muted/60 p-1"
          >
            {TABS.map((tab) => {
              const isActive = active === tab.value;
              const showBadge = tab.value === "ai" && pendingProposalsCount > 0;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(tab.value)}
                  className={cn(
                    "relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <m.span
                      layoutId="note-context-tab-pill"
                      transition={
                        reduce
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 380, damping: 32 }
                      }
                      className="absolute inset-0 rounded-full bg-card shadow-[0_1px_4px_-1px_rgba(0,0,0,0.12),0_1px_2px_-1px_rgba(0,0,0,0.06)]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                  {showBadge && (
                    <span className="relative z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {pendingProposalsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      </div>

      {/* ── Active panel ── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div role="tabpanel" hidden={active !== "context"} className="h-full">
          {active === "context" && contextPanel}
        </div>
        <div role="tabpanel" hidden={active !== "ai"} className="h-full">
          {active === "ai" && aiPanel}
        </div>
        <div role="tabpanel" hidden={active !== "more"} className="h-full">
          {active === "more" && morePanel}
        </div>
      </div>
    </div>
  );
}
