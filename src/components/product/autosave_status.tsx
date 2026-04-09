import { Loader2, Check, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

interface AutosaveStatusProps {
  state: AutosaveState;
  savedAt?: Date | null;
  error?: string | null;
  className?: string;
}

function formatSavedAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

/**
 * Subtle autosave indicator for the note editor toolbar.
 * Returns null when state is "idle" to take up no space.
 */
export function AutosaveStatus({
  state,
  savedAt,
  error,
  className,
}: AutosaveStatusProps) {
  if (state === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn("flex items-center gap-1.5 text-xs", className)}
    >
      {state === "saving" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Saving…</span>
        </>
      )}

      {state === "saved" && (
        <>
          <Check className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">
            {savedAt ? `Saved ${formatSavedAgo(savedAt)}` : "Saved"}
          </span>
        </>
      )}

      {state === "error" && (
        <>
          <CloudOff className="h-3 w-3 shrink-0 text-destructive" />
          <span className="max-w-[180px] truncate text-destructive">
            {error ?? "Save failed"}
          </span>
        </>
      )}
    </div>
  );
}
