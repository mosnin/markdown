"use client";

import { Globe, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SharedObjectTrustBadge
 *
 * Compact status badge shown on workspace-reusable skills and agents.
 * Communicates that the object is shared across boxes and that external
 * writes require a proposal. Uses calm, technical language — not alarmist.
 */

interface SharedObjectTrustBadgeProps {
  /** Number of boxes this object is currently attached to. */
  attachedBoxCount?: number;
  /** Compact mode omits the detail text. */
  compact?: boolean;
  className?: string;
}

export function SharedObjectTrustBadge({
  attachedBoxCount,
  compact = false,
  className,
}: SharedObjectTrustBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/60",
        "bg-muted/40 px-2 py-1 text-xs text-muted-foreground",
        className
      )}
    >
      <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="font-medium">Workspace shared</span>
      {!compact && (
        <>
          <span className="text-muted-foreground/60">·</span>
          <span>External writes require a proposal</span>
        </>
      )}
      {attachedBoxCount !== undefined && attachedBoxCount > 0 && (
        <>
          <span className="text-muted-foreground/60">·</span>
          <span>
            {attachedBoxCount} {attachedBoxCount === 1 ? "box" : "boxes"} attached
          </span>
        </>
      )}
    </div>
  );
}

/**
 * ProposalOnlyBadge
 *
 * Tighter badge used inline to mark that a field or action is
 * proposal-only for external connections.
 */
export function ProposalOnlyBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-border/50",
        "bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground",
        className
      )}
    >
      <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      proposal only
    </span>
  );
}
