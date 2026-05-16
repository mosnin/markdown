"use client";

import * as m from "motion/react-m";
import { Bot } from "lucide-react";
import { fadeRiseHero } from "@/lib/motion";

/**
 * Animated page header for the Agents list page.
 * Extracted as a client component so the parent server page can
 * render its async data-fetching while still animating the heading.
 */
export function AgentsPageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-background px-4 pt-4 pb-4 md:px-6 md:pt-6">
      <m.div
        initial="hidden"
        animate="visible"
        variants={fadeRiseHero}
        className="flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5">
          <Bot className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-title font-semibold tracking-tight">Agents</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Workspace-level reusable agents shared across all boxes
            </p>
          </div>
        </div>
        {children}
      </m.div>
    </div>
  );
}
