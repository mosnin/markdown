"use client";
import { useState } from "react";
import { Share2, Check, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getShareLinkAction, revokeBoxShareLinkAction } from "@/app/app/boxes/share_actions";

/**
 * Share / revoke a box's public link.
 *
 * `parts` controls which controls render so the redesigned box header can
 * surface "Share" as a primary pill while tucking "Revoke link" into the •••
 * overflow menu — both still call the same server actions:
 *   - "both"        — Share button + Revoke button (original behaviour)
 *   - "share"       — just the Share pill
 *   - "share-row"   — just Share (copy link), styled as a full-width menu row
 *   - "revoke-row"  — just Revoke, styled as a full-width menu row
 */
type ShareBoxParts = "both" | "share" | "share-row" | "revoke-row";

export function ShareBoxButton({
  boxId,
  parts = "both",
}: {
  boxId: string;
  parts?: ShareBoxParts;
}) {
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

  const shareBtn = (
    <Button
      variant="outline"
      size="sm"
      onClick={handleShare}
      disabled={pending}
      className="gap-1.5 rounded-full"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Share"}
    </Button>
  );

  // Share (copy link) rendered as a clean full-width row for the overflow menu.
  const shareRow = (
    <button
      type="button"
      onClick={handleShare}
      disabled={pending}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-fast",
        "hover:bg-accent hover:text-foreground disabled:opacity-50"
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? "Link copied!" : "Copy share link"}
    </button>
  );

  // Revoke rendered as a clean full-width row for the overflow menu.
  const revokeRow = (
    <button
      type="button"
      onClick={handleRevoke}
      disabled={revoking}
      title="Revoke the current share link"
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-fast",
        "hover:bg-accent hover:text-foreground disabled:opacity-50"
      )}
    >
      <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
      {revoked ? "Revoked" : "Revoke share link"}
    </button>
  );

  if (parts === "share") return shareBtn;
  if (parts === "share-row") return shareRow;
  if (parts === "revoke-row") return revokeRow;

  return (
    <div className="flex items-center gap-1.5">
      {shareBtn}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRevoke}
        disabled={revoking}
        title="Revoke the current share link"
        className="gap-1.5 rounded-full text-muted-foreground"
      >
        <Link2Off className="h-3.5 w-3.5" />
        {revoked ? "Revoked" : "Revoke link"}
      </Button>
    </div>
  );
}
