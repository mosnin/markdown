"use client";

import { useState } from "react";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeterogeneousVersionTimeline } from "./heterogeneous_version_timeline";
import type { ObjectVersion } from "@/server/domain/types/object_version";

/**
 * ObjectHistoryPanel
 *
 * Collapsible history panel for file, skill, and agent detail pages.
 * Wraps HeterogeneousVersionTimeline in a collapsible container so the
 * page header stays uncluttered.
 *
 * Shows version count and current version label in the collapsed state.
 */

interface ObjectVersionWithCurrent extends ObjectVersion {
  is_current: boolean;
}

interface ObjectHistoryPanelProps {
  objectType: "file" | "skill" | "agent";
  objectId: string;
  versions: ObjectVersionWithCurrent[];
  currentVersionId: string | null;
  onRollback?: (versionId: string) => Promise<{ ok: boolean; error?: string }>;
  rollbackDisabled?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

export function ObjectHistoryPanel({
  objectType,
  objectId,
  versions,
  currentVersionId,
  onRollback,
  rollbackDisabled = false,
  defaultOpen = false,
  className,
}: ObjectHistoryPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const currentVersion = versions.find((v) => v.is_current);
  const typeLabel = objectType.charAt(0).toUpperCase() + objectType.slice(1);

  return (
    <div className={cn("rounded-lg border border-border/50 bg-card", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between px-4 py-3",
          "text-left transition-colors hover:bg-muted/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "border-b border-border/40"
        )}
        aria-expanded={open}
        aria-controls={`history-panel-${objectId}`}
      >
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">Version History</span>
          {versions.length > 0 && (
            <span className="rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {versions.length}
            </span>
          )}
          {currentVersion && (
            <span className="text-xs text-muted-foreground">
              · v{currentVersion.version_number} current
            </span>
          )}
        </div>

        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div id={`history-panel-${objectId}`} className="px-4 py-3">
          {versions.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No version history available.
            </p>
          ) : (
            <>
              {rollbackDisabled && (
                <p className="mb-3 text-xs text-muted-foreground/70">
                  Rollback is not available while the {typeLabel.toLowerCase()} is archived or trashed.
                </p>
              )}
              <HeterogeneousVersionTimeline
                objectType={objectType}
                objectId={objectId}
                versions={versions}
                currentVersionId={currentVersionId}
                onRollback={onRollback}
                rollbackDisabled={rollbackDisabled}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
