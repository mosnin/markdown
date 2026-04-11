"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, Link2Off } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { detachFromBoxAction } from "@/app/app/boxes/actions";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReferenceContextBannerProps {
  /** The box this reusable is currently being viewed in context of. */
  boxId: string;
  boxName: string;
  /** The object type being viewed. */
  objectType: "skill" | "agent";
  /** The reusable object's id. */
  objectId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Shown at the top of a reusable skill or agent page when opened from a box
 * context (`?box_id=xxx`). Communicates that edits here affect all boxes where
 * this object is attached. Provides a safe detach action.
 */
export function ReferenceContextBanner({
  boxId,
  boxName,
  objectType,
  objectId,
}: ReferenceContextBannerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [detachError, setDetachError] = useState<string | null>(null);

  function handleDetach() {
    setDetachError(null);
    startTransition(async () => {
      const result = await detachFromBoxAction(boxId, objectType, objectId);
      if (result.ok) {
        router.push(`/app/boxes/${boxId}`);
      } else {
        setDetachError(result.error);
        setConfirmDetach(false);
      }
    });
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3",
        "text-xs text-muted-foreground"
      )}
    >
      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />

      <div className="flex flex-1 flex-col gap-1.5 min-w-0">
        <p>
          You are viewing this{" "}
          <span className="font-medium text-foreground">
            {objectType === "skill" ? "skill" : "agent"}
          </span>{" "}
          in the context of{" "}
          <Link
            href={`/app/boxes/${boxId}`}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {boxName}
          </Link>
          . This is a workspace-level reusable — edits apply everywhere it is attached.
        </p>

        {detachError && (
          <p className="text-destructive" role="alert">
            {detachError}
          </p>
        )}

        {!confirmDetach ? (
          <button
            type="button"
            onClick={() => setConfirmDetach(true)}
            className={cn(
              "flex w-fit items-center gap-1 rounded px-1.5 py-0.5 transition-colors duration-150",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
            disabled={isPending}
          >
            <Link2Off className="h-3 w-3" aria-hidden="true" />
            Detach from {boxName}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span>Remove this reference from {boxName}?</span>
            <button
              type="button"
              onClick={handleDetach}
              disabled={isPending}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors duration-150",
                "bg-destructive/10 text-destructive hover:bg-destructive/20",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {isPending ? "Removing…" : "Yes, detach"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDetach(false)}
              disabled={isPending}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors duration-150",
                "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
