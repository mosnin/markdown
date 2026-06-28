"use client";
import { useState, useTransition } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateBoxAction } from "@/app/app/boxes/actions";

/**
 * Toggle a box's public visibility.
 *
 * `variant` controls presentation so the redesigned box header can surface the
 * toggle as a full-width row inside the ••• overflow menu while other surfaces
 * keep the standalone pill — both call the same server action.
 *   - "pill" — standalone rounded pill (default)
 *   - "row"  — full-width menu row (for the overflow menu)
 */
export function BoxPublicToggle({
  boxId,
  initialIsPublic,
  variant = "pill",
}: {
  boxId: string;
  initialIsPublic: boolean;
  variant?: "pill" | "row";
}) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !isPublic;
    setIsPublic(next);
    startTransition(async () => {
      await updateBoxAction(boxId, { is_public: next });
    });
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition-fast disabled:opacity-50",
          isPublic
            ? "text-violet-700 hover:bg-accent dark:text-violet-400"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <span className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          {isPublic ? "Public" : "Make public"}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
            isPublic ? "bg-primary" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "inline-block h-3 w-3 transform rounded-full bg-card shadow-sm transition-transform",
              isPublic ? "translate-x-3.5" : "translate-x-0.5"
            )}
          />
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50",
        isPublic
          ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-400"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
      )}
    >
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      {isPublic ? "Public" : "Make public"}
    </button>
  );
}
