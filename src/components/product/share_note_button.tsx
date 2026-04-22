"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getNoteShareLinkAction } from "@/app/app/notes/share_actions";

export function ShareNoteButton({ noteId }: { noteId: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleShare() {
    if (pending) return;
    setPending(true);
    try {
      const result = await getNoteShareLinkAction(noteId);
      if (!result.ok) return;
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleShare} disabled={pending} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Share"}
    </Button>
  );
}
