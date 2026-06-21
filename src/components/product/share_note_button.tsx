"use client";

import { useState } from "react";
import { Share2, Check, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getNoteShareLinkAction, revokeNoteShareLinkAction } from "@/app/app/notes/share_actions";

/**
 * Share / revoke a note's public link.
 *
 * `parts` controls which controls render so the redesigned note header can
 * surface "Share" as a primary pill while tucking "Revoke link" into the •••
 * overflow menu — both still call the same server actions:
 *   - "both"        — Share button + Revoke button (original behaviour)
 *   - "share"       — just the Share pill
 *   - "revoke-row"  — just Revoke, styled as a full-width menu row
 */
type ShareNoteParts = "both" | "share" | "revoke-row";

export function ShareNoteButton({
  noteId,
  parts = "both",
}: {
  noteId: string;
  parts?: ShareNoteParts;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  async function handleShare() {
    if (pending) return;
    setPending(true);
    try {
      const result = await getNoteShareLinkAction(noteId);
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
      const result = await revokeNoteShareLinkAction(noteId);
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
