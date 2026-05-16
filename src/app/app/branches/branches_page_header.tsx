"use client";

import * as m from "motion/react-m";
import { GitBranch } from "lucide-react";
import { fadeRiseHero } from "@/lib/motion";

/**
 * Animated page header for the Branches management page.
 * Extracted as a client component so the parent server page keeps
 * its async data-fetching while still animating the heading.
 */
export function BranchesPageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-background px-6 pt-6 pb-4">
      <m.div
        initial="hidden"
        animate="visible"
        variants={fadeRiseHero}
        className="flex items-start justify-between gap-4"
      >
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-title font-semibold tracking-tight">Draft branches</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Safe exploratory editing for notes, files, skills, and agents. Every change
              you make on a branch stays off main until you promote it.
            </p>
          </div>
        </div>
        {children}
      </m.div>
    </div>
  );
}
