"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Clock, User, Cpu, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ObjectVersion } from "@/server/domain/types/object_version";

/**
 * HeterogeneousVersionTimeline
 *
 * Version history timeline for files, skills, and agents.
 * Mirrors the design intent of the note version history but uses
 * ObjectVersion instead of NoteVersion.
 *
 * Key principles:
 *   - History is immutable: only reads here, no deletions
 *   - Rollback is human-only: creates a NEW version, does not rewrite history
 *   - Actor type (user / connection / system) is always visible
 *   - Change origin is always visible (human_edit / proposal_approved / rollback / import)
 *   - Rollback confirmation is required to prevent accidental state changes
 *
 * Diff fidelity note:
 *   For files/skills/agents, diff_summary is a lightweight JSON blob (not a
 *   structured line-diff). The UI shows byte changes and version numbers, not
 *   a full diff view. This is honest about current implementation fidelity.
 */

interface VersionTimelineItem extends ObjectVersion {
  is_current: boolean;
}

interface HeterogeneousVersionTimelineProps {
  objectType: "file" | "skill" | "agent";
  objectId: string;
  versions: VersionTimelineItem[];
  currentVersionId: string | null;
  onRollback?: (versionId: string) => Promise<{ ok: boolean; error?: string }>;
  /** When true, rollback is not available (e.g. object is archived/trashed). */
  rollbackDisabled?: boolean;
  className?: string;
}

const CHANGE_ORIGIN_LABELS: Record<string, { label: string; className: string }> = {
  human_edit: { label: "Human edit", className: "text-foreground" },
  proposal_approved: { label: "Proposal approved", className: "text-blue-600 dark:text-blue-400" },
  rollback: { label: "Rollback", className: "text-amber-600 dark:text-amber-400" },
  import: { label: "Import", className: "text-muted-foreground" },
  generated: { label: "Generated", className: "text-purple-600 dark:text-purple-400" },
};

const ACTOR_ICONS: Record<string, React.ReactNode> = {
  user: <User className="h-3 w-3" aria-hidden="true" />,
  connection: <Cpu className="h-3 w-3" aria-hidden="true" />,
  system: <Settings2 className="h-3 w-3" aria-hidden="true" />,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HeterogeneousVersionTimeline({
  objectType,
  versions,
  onRollback,
  rollbackDisabled = false,
  className,
}: HeterogeneousVersionTimelineProps) {
  const [isPending, startTransition] = useTransition();
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRollback(versionId: string) {
    if (!onRollback) return;
    setError(null);
    startTransition(async () => {
      const result = await onRollback(versionId);
      if (result.ok) {
        setRollbackTarget(null);
      } else {
        setError(result.error ?? "Rollback failed");
      }
    });
  }

  if (versions.length === 0) {
    return (
      <div className={cn("py-8 text-center text-xs text-muted-foreground", className)}>
        No versions recorded yet.
      </div>
    );
  }

  const typeLabel = objectType.charAt(0).toUpperCase() + objectType.slice(1);

  return (
    <div className={cn("flex flex-col gap-0", className)} role="list" aria-label={`${typeLabel} version history`}>
      {error && (
        <p className="mb-2 text-xs text-destructive" role="alert">{error}</p>
      )}

      {versions.map((v, idx) => {
        const originConfig = CHANGE_ORIGIN_LABELS[v.change_origin] ?? {
          label: v.change_origin,
          className: "text-muted-foreground",
        };
        const isFirst = idx === 0;
        const isLast = idx === versions.length - 1;

        return (
          <div
            key={v.id}
            role="listitem"
            className={cn(
              "relative flex items-start gap-3 px-1 py-3",
              !isLast && "border-b border-border/40"
            )}
          >
            {/* Timeline dot */}
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
              {v.is_current ? (
                <div className="h-2.5 w-2.5 rounded-full bg-foreground" aria-label="Current version" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-border" />
              )}
            </div>

            {/* Content */}
            <div className="flex flex-1 flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Version number */}
                <span className="font-mono text-[11px] font-medium text-foreground">
                  v{v.version_number}
                </span>

                {/* Current marker */}
                {v.is_current && (
                  <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    current
                  </span>
                )}

                {/* Change origin */}
                <span className={cn("text-xs", originConfig.className)}>
                  {originConfig.label}
                </span>

                {/* Actor */}
                <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
                  {ACTOR_ICONS[v.actor_type] ?? <User className="h-3 w-3" />}
                  <span className="font-mono text-[10px]">
                    {v.actor_type}
                  </span>
                </span>
              </div>

              {/* Timestamp + size */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {formatDate(v.created_at)}
                </span>
                <span>{formatBytes(v.content_bytes)}</span>
              </div>

              {/* Diff summary (honest: lightweight JSON, not full diff) */}
              {v.diff_summary && typeof v.diff_summary === "object" && (
                <div className="text-[11px] text-muted-foreground/70">
                  {(v.diff_summary as Record<string, unknown>).bytes_after !== undefined && (
                    <span>
                      {formatBytes(Number((v.diff_summary as Record<string, unknown>).bytes_after))} after change
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Rollback button */}
            {!v.is_current && onRollback && !rollbackDisabled && (
              <div className="shrink-0">
                {rollbackTarget === v.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Restore to v{v.version_number}?</span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRollback(v.id)}
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                      aria-label={`Confirm rollback to version ${v.version_number}`}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => setRollbackTarget(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRollbackTarget(v.id)}
                    className={cn(
                      "flex items-center gap-1 rounded border border-border/50 px-2 py-1",
                      "text-[11px] text-muted-foreground transition-colors",
                      "hover:border-border hover:bg-muted/60 hover:text-foreground"
                    )}
                    aria-label={`Rollback to version ${v.version_number}`}
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Rollback
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
