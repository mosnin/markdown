"use client";

import * as m from "motion/react-m";
import { Zap } from "lucide-react";
import { fadeRiseHero } from "@/lib/motion";

/**
 * Animated page header for the Skills list page.
 * Extracted as a client component so the parent server page can
 * render its async data-fetching while still animating the heading.
 */
export function SkillsPageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-background px-4 pt-4 pb-4 md:px-6 md:pt-6">
      <m.div
        initial="hidden"
        animate="visible"
        variants={fadeRiseHero}
        className="flex items-center gap-2.5"
      >
        <Zap className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-title font-semibold tracking-tight">Skills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Workspace-level reusable skills shared across all boxes
          </p>
        </div>
        {children}
      </m.div>
    </div>
  );
}
