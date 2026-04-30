"use client";
import { useState, useTransition } from "react";
import { Globe } from "lucide-react";
import { updateBoxAction } from "@/app/app/boxes/actions";

export function BoxPublicToggle({ boxId, initialIsPublic }: { boxId: string; initialIsPublic: boolean }) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !isPublic;
    setIsPublic(next);
    startTransition(async () => {
      await updateBoxAction(boxId, { is_public: next });
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${
        isPublic
          ? "border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-400"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
      }`}
    >
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      {isPublic ? "Public" : "Make public"}
    </button>
  );
}
