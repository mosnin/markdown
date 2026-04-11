"use client";

import { FileCode, Zap, Bot, FileText, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SharedObjectTrustBadge } from "./shared_object_trust_badge";

/**
 * ObjectTrustHeader
 *
 * Compact header bar shown at the top of file, skill, and agent detail pages.
 * Communicates:
 *   - Object type and name
 *   - Trust level (workspace shared vs. box local)
 *   - Pending proposal count (if any)
 *   - Lifecycle status (archived / trashed / draft)
 *   - Machine provenance hint (if object was generated)
 *
 * Design principles:
 *   - Calm and technical, not alarming
 *   - Only show trust-sensitive cues when they carry signal
 *   - Preserve strong sense of place
 */

type ObjectType = "file" | "skill" | "agent" | "note";

interface ObjectTrustHeaderProps {
  objectType: ObjectType;
  objectName: string;
  isReusable?: boolean;
  attachedBoxCount?: number;
  pendingProposalCount?: number;
  lifecycleStatus?: "draft" | "active" | "archived" | "trashed";
  /** Set when origin_type is 'generated' */
  isGenerated?: boolean;
  /** Canonical format label (e.g. "typescript", "markdown") */
  canonicalFormat?: string;
  className?: string;
}

function objectIcon(type: ObjectType, className?: string) {
  switch (type) {
    case "file":
      return <FileCode className={cn("h-4 w-4", className)} aria-hidden="true" />;
    case "skill":
      return <Zap className={cn("h-4 w-4", className)} aria-hidden="true" />;
    case "agent":
      return <Bot className={cn("h-4 w-4", className)} aria-hidden="true" />;
    case "note":
      return <FileText className={cn("h-4 w-4", className)} aria-hidden="true" />;
  }
}

function objectTypeLabel(type: ObjectType) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function LifecycleBadge({ status }: { status: string }) {
  if (status === "active") return null;

  const config: Record<string, { label: string; className: string }> = {
    draft: {
      label: "Draft",
      className: "bg-muted/60 text-muted-foreground border-border/50",
    },
    archived: {
      label: "Archived",
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    },
    trashed: {
      label: "Trashed",
      className: "bg-destructive/10 text-destructive border-destructive/30",
    },
  };

  const c = config[status];
  if (!c) return null;

  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium",
        c.className
      )}
      aria-label={`Status: ${c.label}`}
    >
      {c.label}
    </span>
  );
}

export function ObjectTrustHeader({
  objectType,
  objectName,
  isReusable = false,
  attachedBoxCount,
  pendingProposalCount = 0,
  lifecycleStatus = "active",
  isGenerated = false,
  canonicalFormat,
  className,
}: ObjectTrustHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border/50",
        "bg-muted/20 px-3 py-2 text-xs",
        className
      )}
      role="banner"
      aria-label={`${objectTypeLabel(objectType)} trust header`}
    >
      {/* Icon + type */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {objectIcon(objectType, "shrink-0")}
        <span className="font-medium text-foreground truncate max-w-[200px]" title={objectName}>
          {objectName}
        </span>
        <span className="text-muted-foreground/60">{objectTypeLabel(objectType)}</span>
      </div>

      {/* Format */}
      {canonicalFormat && (
        <span className="rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {canonicalFormat}
        </span>
      )}

      {/* Lifecycle status */}
      <LifecycleBadge status={lifecycleStatus} />

      {/* Workspace shared badge */}
      {isReusable && (
        <SharedObjectTrustBadge
          attachedBoxCount={attachedBoxCount}
          compact={pendingProposalCount > 0}
        />
      )}

      {/* Pending proposals */}
      {pendingProposalCount > 0 && (
        <div
          className={cn(
            "flex items-center gap-1 rounded border border-amber-500/40",
            "bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400"
          )}
          role="status"
          aria-label={`${pendingProposalCount} pending proposal${pendingProposalCount !== 1 ? "s" : ""}`}
        >
          <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {pendingProposalCount} pending {pendingProposalCount === 1 ? "proposal" : "proposals"}
          </span>
        </div>
      )}

      {/* Machine provenance hint */}
      {isGenerated && (
        <span className="text-muted-foreground/60 italic">Generated</span>
      )}
    </div>
  );
}
