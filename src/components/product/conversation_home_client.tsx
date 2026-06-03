"use client";

import Link from "next/link";
import { ArrowRight, Plug, Sparkles } from "lucide-react";
import { OperatorPanel } from "@/components/product/operator/operator_panel";

export interface ConversationHomeClientProps {
  defaultBoxId?: string | null;
  /**
   * True when the workspace has no user-created context yet (a freshly
   * bootstrapped workspace, possibly with only the seeded starter box).
   * Surfaces a one-time activation banner pointing at the core loop so a
   * new user is never staring at a bare prompt with no idea what to do.
   */
  isFirstRun?: boolean;
}

export function ConversationHomeClient({
  defaultBoxId,
  isFirstRun = false,
}: ConversationHomeClientProps) {
  return (
    <div className="flex flex-col h-full">
      {isFirstRun && <FirstRunBanner />}
      <div className="min-h-0 flex-1">
        <OperatorPanel mode="page" defaultBoxId={defaultBoxId ?? undefined} />
      </div>
    </div>
  );
}

/**
 * Activation banner shown on the home surface for a brand-new workspace.
 * Explains the loop in one line and gives the single most important next
 * action — connect an agent — without removing any existing functionality
 * (the operator/AI panel still renders directly beneath it).
 */
function FirstRunBanner() {
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-iris">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              Welcome to Poggle — the context OS for your AI agents
            </p>
            <p className="text-sm text-muted-foreground">
              Connect an agent &rarr; it reads your workspace and proposes
              changes &rarr; you approve them in{" "}
              <Link
                href="/app/proposals"
                className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                AI Edits
              </Link>{" "}
              before anything is written.
            </p>
          </div>
        </div>
        <Link
          href="/app/connect"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:self-auto"
        >
          <Plug className="h-3.5 w-3.5" aria-hidden="true" />
          Connect an agent
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
