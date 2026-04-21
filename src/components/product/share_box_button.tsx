"use client";
import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getShareLinkAction } from "@/app/app/boxes/share_actions";

export function ShareBoxButton({ boxId }: { boxId: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleShare() {
    if (pending) return;
    setPending(true);
    try {
      const result = await getShareLinkAction(boxId);
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
