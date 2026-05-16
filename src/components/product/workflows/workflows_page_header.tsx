"use client";

import * as m from "motion/react-m";
import { GitFork } from "lucide-react";
import { fadeRiseHero } from "@/lib/motion";

/**
 * Animated page header for the Workflows list page.
 * Extracted as a client component so the parent server page can
 * render its async data-fetching while still animating the heading.
 */
export function WorkflowsPageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-background px-6 pt-6 pb-4">
      <m.div
        initial="hidden"
        animate="visible"
        variants={fadeRiseHero}
        className="flex items-start justify-between gap-4"
      >
        <div className="flex items-center gap-2.5">
          <GitFork className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-title font-semibold tracking-tight">Workflows</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Visual builder for multi-step agent flows. Chain sub-agents, web tools, and
              transformations into reusable pipelines.
            </p>
          </div>
        </div>
        {children}
      </m.div>
    </div>
  );
}
