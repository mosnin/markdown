"use client";

import { useState, useTransition } from "react";
import { Archive, Trash2, RotateCcw, ArchiveRestore } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ObjectLifecyclePanel
 *
 * Compact lifecycle controls for files, skills, and agents.
 * Shows contextually appropriate actions based on current status.
 *
 * Archive and trash are distinct:
 *   - Archive: reversible, object still queryable, counts as non-active
 *   - Trash: soft-delete, excluded from normal retrieval
 *
 * The component is deliberately minimal and serious — no confirmation
 * dialogs by default, but the trash action has a brief confirmation step
 * because it excludes the object from normal retrieval.
 */

type LifecycleStatus = "draft" | "active" | "archived" | "trashed";

interface ObjectLifecyclePanelProps {
  objectId: string;
  objectType: "file" | "skill" | "agent";
  currentStatus: LifecycleStatus;
  objectName: string;
  onArchive?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onUnarchive?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onTrash?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onRestore?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  className?: string;
}

export function ObjectLifecyclePanel({
  objectId,
  objectType,
  currentStatus,
  objectName,
  onArchive,
  onUnarchive,
  onTrash,
  onRestore,
  className,
}: ObjectLifecyclePanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [trashConfirm, setTrashConfirm] = useState(false);

  function handle(fn?: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    if (!fn) return;
    setError(null);
    startTransition(async () => {
      const result = await fn(objectId);
      if (!result.ok) setError(result.error ?? "Action failed");
    });
  }

  const typeLabel = objectType.charAt(0).toUpperCase() + objectType.slice(1);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Lifecycle
      </p>

      <div className="flex flex-wrap gap-2">
        {/* Active state: can archive or trash */}
        {(currentStatus === "active" || currentStatus === "draft") && (
          <>
            {onArchive && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => handle(onArchive)}
                className={cn(
                  "flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5",
                  "text-xs text-muted-foreground transition-colors",
                  "hover:border-border hover:bg-muted/60 hover:text-foreground",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label={`Archive ${typeLabel.toLowerCase()}`}
              >
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                Archive
              </button>
            )}

            {onTrash && !trashConfirm && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setTrashConfirm(true)}
                className={cn(
                  "flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5",
                  "text-xs text-muted-foreground transition-colors",
                  "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label={`Trash ${typeLabel.toLowerCase()}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Trash
              </button>
            )}

            {onTrash && trashConfirm && (
              <div className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/10 px-2.5 py-1.5">
                <span className="text-xs text-destructive">
                  Trash &ldquo;{objectName}&rdquo;?
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => { setTrashConfirm(false); handle(onTrash); }}
                  className="rounded border border-destructive/40 bg-destructive/20 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/30 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setTrashConfirm(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        {/* Archived state: can unarchive or trash */}
        {currentStatus === "archived" && (
          <>
            {onUnarchive && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => handle(onUnarchive)}
                className={cn(
                  "flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5",
                  "text-xs text-muted-foreground transition-colors",
                  "hover:border-border hover:bg-muted/60 hover:text-foreground",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label={`Unarchive ${typeLabel.toLowerCase()}`}
              >
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                Unarchive
              </button>
            )}

            {onTrash && !trashConfirm && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setTrashConfirm(true)}
                className={cn(
                  "flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5",
                  "text-xs text-muted-foreground transition-colors",
                  "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label={`Trash ${typeLabel.toLowerCase()}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Trash
              </button>
            )}

            {onTrash && trashConfirm && (
              <div className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/10 px-2.5 py-1.5">
                <span className="text-xs text-destructive">
                  Trash &ldquo;{objectName}&rdquo;?
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => { setTrashConfirm(false); handle(onTrash); }}
                  className="rounded border border-destructive/40 bg-destructive/20 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/30 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setTrashConfirm(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        {/* Trashed state: can only restore */}
        {currentStatus === "trashed" && onRestore && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => handle(onRestore)}
            className={cn(
              "flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5",
              "text-xs text-muted-foreground transition-colors",
              "hover:border-border hover:bg-muted/60 hover:text-foreground",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            aria-label={`Restore ${typeLabel.toLowerCase()}`}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Restore
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
