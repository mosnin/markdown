"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AttachToBoxDialog } from "@/components/product/attach_to_box_dialog";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AttachToBoxTriggerProps {
  objectType: "skill" | "agent";
  objectId: string;
  objectName: string;
  boxes: Array<{ id: string; name: string }>;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Small "Attach to box" button rendered alongside a library card.
 * Manages dialog open state; delegates to AttachToBoxDialog for the actual UI.
 */
export function AttachToBoxTrigger({
  objectType,
  objectId,
  objectName,
  boxes,
}: AttachToBoxTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Attach to box"
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-colors duration-150",
          "border border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <Link2 className="h-3 w-3" aria-hidden="true" />
        Attach to box
      </button>

      <AttachToBoxDialog
        objectType={objectType}
        objectId={objectId}
        objectName={objectName}
        boxes={boxes}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
