"use client";

import { useState, useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { togglePinnedSkillAction } from "@/app/app/skills/pin_actions";

interface PinSkillToggleProps {
  attachmentId: string;
  initialIsPinned: boolean;
}

export function PinSkillToggle({ attachmentId, initialIsPinned }: PinSkillToggleProps) {
  const [isPinned, setIsPinned] = useState(initialIsPinned);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !isPinned;
    setIsPinned(next);
    startTransition(async () => {
      const result = await togglePinnedSkillAction(attachmentId, next);
      if (!result.ok) setIsPinned(!next); // revert on error
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      title={isPinned ? "Unpin from box" : "Pin as default for this box"}
      className={cn(
        "rounded p-1 transition-colors",
        isPinned
          ? "text-brand-600 hover:text-brand-700"
          : "text-muted-foreground/40 hover:text-muted-foreground",
        "disabled:opacity-50"
      )}
      aria-label={isPinned ? "Unpin skill" : "Pin skill as default"}
    >
      {isPinned ? (
        <Pin className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
