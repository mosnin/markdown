"use client";

import { useState, useTransition } from "react";
import { Bot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setFolderGeneratedPolicyAction } from "@/app/app/proposals/actions";

interface FolderPolicyToggleProps {
  folderId: string;
  initialAccepts: boolean;
  /** Compact display for inline use inside the folder tree. */
  compact?: boolean;
}

/**
 * Toggle for accepts_generated_notes on a folder.
 *
 * When enabled, connections with generate_in_allowed_folders permission may
 * write generated notes directly to this folder without requiring approval.
 *
 * Keeping this small and explicit — no modals, no wizards.
 */
export function FolderPolicyToggle({
  folderId,
  initialAccepts,
  compact = false,
}: FolderPolicyToggleProps) {
  const [accepts, setAccepts] = useState(initialAccepts);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next = !accepts;
    setError(null);
    startTransition(async () => {
      const result = await setFolderGeneratedPolicyAction(folderId, next);
      if (result.success) {
        setAccepts(next);
      } else {
        setError(result.error);
      }
    });
  }

  if (compact) {
    return (
      <button
        onClick={handleToggle}
        disabled={isPending}
        title={
          accepts
            ? "Generated notes allowed — click to disable"
            : "Generated notes blocked — click to allow"
        }
        className={cn(
          "rounded p-0.5 transition-fast",
          accepts
            ? "text-primary hover:text-primary/70"
            : "text-muted-foreground/40 hover:text-muted-foreground"
        )}
        aria-label="Toggle generated note policy"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Bot className="h-3 w-3" />
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Accept generated notes</p>
          <p className="text-xs text-muted-foreground truncate">
            Allows AI connections to write directly to this folder
          </p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={accepts}
        onClick={handleToggle}
        disabled={isPending}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          accepts ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm",
            "transform transition-transform",
            accepts ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
      {error && <p className="text-xs text-destructive ml-1">{error}</p>}
    </div>
  );
}
