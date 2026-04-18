"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { reindexWorkspaceAction } from "./actions";
import { REINDEX_MAX_PER_CALL } from "./constants";

/**
 * Local success-shape alias. We can't import `ReindexActionResult`
 * (a tagged union) from a `"use server"` module without widening, so
 * the client mirrors the shape here narrowly enough for the UI.
 */
type ReindexSuccessData = {
  indexed: number;
  failed: number;
  skipped: number;
  total: number;
  status: "complete" | "partial";
};

/**
 * Reindex-workspace admin panel.
 *
 * Renders a single action button that kicks off an inline reindex of
 * every note's embedding in the caller's workspace. The action is
 * gated to admin/owner server-side, so the button is disabled for
 * non-admins here purely as a UX hint — the server is still the
 * authoritative check.
 */
export function ReindexPanel({ canEdit }: { canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReindexSuccessData | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  function handleClick() {
    setErrorText(null);
    setResult(null);
    startTransition(async () => {
      const res = await reindexWorkspaceAction();
      if (res.ok) {
        setResult(res.data);
      } else {
        setErrorText(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">
              Reindex embeddings
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Recompute vector embeddings for every note in this workspace.
              Safe to run anytime &mdash; unchanged notes are skipped via a
              content hash.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Admin
          </Badge>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="flex flex-col gap-4 pt-5">
        <p className="text-xs text-muted-foreground">
          Runs inline. For workspaces with more than {REINDEX_MAX_PER_CALL}{" "}
          notes the first {REINDEX_MAX_PER_CALL} (most recently updated) are
          processed per click; re-run to continue.
        </p>

        {result && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
              result.failed === 0
                ? "border-border bg-accent/40"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            )}
            role="status"
          >
            {result.failed === 0 ? (
              <Check
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
            ) : (
              <AlertCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            )}
            <div className="flex-1">
              <p className="font-medium">
                {result.status === "partial"
                  ? `Partial pass complete (${result.total} total notes in workspace).`
                  : "Reindex complete."}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                Indexed: {result.indexed} &middot; Skipped:{" "}
                {result.skipped} &middot; Failed: {result.failed}
                {result.status === "partial" &&
                  " \u2014 click again to continue."}
              </p>
            </div>
          </div>
        )}

        {errorText && (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <p className="flex-1">{errorText}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleClick}
            disabled={!canEdit || pending}
            aria-busy={pending}
          >
            {pending ? (
              <>
                <Loader2
                  className="mr-1.5 h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
                Reindexing&#8230;
              </>
            ) : (
              "Reindex workspace"
            )}
          </Button>
        </div>
        {!canEdit && (
          <p className="text-[11px] text-muted-foreground">
            Only workspace admins can reindex embeddings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
