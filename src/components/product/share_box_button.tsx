"use client";
import { useState } from "react";
import { Share2, Check, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getShareLinkAction, revokeBoxShareLinkAction } from "@/app/app/boxes/share_actions";

export function ShareBoxButton({ boxId }: { boxId: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  async function handleShare() {
    if (pending) return;
    setPending(true);
    try {
      const result = await getShareLinkAction(boxId);
      if (!result.ok) return;
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setRevoked(false);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setPending(false);
    }
  }

  async function handleRevoke() {
    if (revoking) return;
    setRevoking(true);
    try {
      const result = await revokeBoxShareLinkAction(boxId);
      if (!result.ok) return;
      setRevoked(true);
      setTimeout(() => setRevoked(false), 2000);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" onClick={handleShare} disabled={pending} className="gap-1.5">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
        {copied ? "Copied!" : "Share"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRevoke}
        disabled={revoking}
        title="Revoke the current share link"
        className="gap-1.5 text-muted-foreground"
      >
        <Link2Off className="h-3.5 w-3.5" />
        {revoked ? "Revoked" : "Revoke link"}
      </Button>
    </div>
  );
}
