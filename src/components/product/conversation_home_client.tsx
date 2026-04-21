"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";
import { WorkspaceConversation } from "@/components/product/workspace_conversation";
import { ConversationComposer } from "@/components/product/conversation_composer";
import { OnboardingCallout } from "@/components/product/onboarding_callout";

export interface ConversationHomeClientProps {
  workspaceId: string;
  workspaceName: string;
  initialRuns: WorkspaceOperatorRunRow[];
  defaultBoxId: string | null;
  hasNoBoxes: boolean;
  nowIso: string;
  userDisplayName: string | null;
}

export function ConversationHomeClient({
  workspaceId,
  workspaceName,
  initialRuns,
  defaultBoxId,
  hasNoBoxes,
  nowIso,
  userDisplayName,
}: ConversationHomeClientProps) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — workspace name + Dashboard link */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {workspaceName}
          </h1>
        </div>
        <Link
          href="/app/dashboard"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
          Dashboard
        </Link>
      </header>

      {/* Onboarding banner when no boxes — Pog can't draft without a box */}
      {hasNoBoxes && (
        <div className="border-b border-border bg-muted/20 px-6 py-4">
          <OnboardingCallout />
        </div>
      )}

      {/* Transcript fills available space */}
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-4">
        <div className="min-h-0 flex-1">
          <WorkspaceConversation
            workspaceId={workspaceId}
            initialRuns={initialRuns}
            nowIso={nowIso}
            activeRunId={activeRunId}
            userDisplayName={userDisplayName}
          />
        </div>

        {/* Composer pinned to bottom */}
        <div className="shrink-0 border-t border-border py-3">
          <ConversationComposer
            workspaceId={workspaceId}
            defaultBoxId={defaultBoxId}
            hasHistory={initialRuns.length > 0}
            onRunStarted={setActiveRunId}
          />
        </div>
      </div>
    </div>
  );
}
