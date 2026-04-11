"use client";

import { useState, useTransition } from "react";
import { Box } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  attachSkillToBoxAction,
  attachAgentToBoxAction,
} from "@/app/app/boxes/actions";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AttachToBoxDialogProps {
  /** The reusable object to attach. */
  objectType: "skill" | "agent";
  objectId: string;
  objectName: string;
  /** Workspace boxes available to attach to. */
  boxes: Array<{ id: string; name: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dialog for attaching a workspace-level reusable skill or agent to a box
 * directly from the library page. The user picks a target box; the object is
 * attached by reference (no copy).
 */
export function AttachToBoxDialog({
  objectType,
  objectId,
  objectName,
  boxes,
  open,
  onOpenChange,
}: AttachToBoxDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClose(v: boolean) {
    if (!isPending) {
      onOpenChange(v);
      if (!v) {
        setSelectedBoxId(null);
        setError(null);
      }
    }
  }

  function handleAttach() {
    if (!selectedBoxId) return;
    setError(null);
    startTransition(async () => {
      const result =
        objectType === "skill"
          ? await attachSkillToBoxAction(selectedBoxId, objectId)
          : await attachAgentToBoxAction(selectedBoxId, objectId);

      if (result.ok) {
        onOpenChange(false);
        setSelectedBoxId(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Attach to box</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Choose a box to attach{" "}
          <span className="font-medium text-foreground">{objectName}</span> to.
          This is a reference — edits to the source apply everywhere it is attached.
        </p>

        {boxes.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No boxes in this workspace yet.
          </p>
        ) : (
          <div className="max-h-60 overflow-auto rounded-lg border border-border bg-muted/10">
            <div className="flex flex-col gap-1 p-2">
              {boxes.map((box) => (
                <button
                  key={box.id}
                  type="button"
                  onClick={() => setSelectedBoxId((prev) => (prev === box.id ? null : box.id))}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedBoxId === box.id
                      ? "border-ring bg-accent text-foreground"
                      : "border-border bg-card text-foreground hover:bg-accent/40"
                  )}
                >
                  <Box className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate font-medium">{box.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleClose(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selectedBoxId || isPending}
            onClick={handleAttach}
          >
            {isPending ? "Attaching…" : "Attach"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
