"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PenLine, X } from "lucide-react";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";
import { WorkspaceConversation } from "@/components/product/workspace/workspace_conversation";
import { ConversationComposer } from "@/components/product/conversation_composer";
import { OnboardingCallout } from "@/components/product/onboarding_callout";
import { BulkImportPanel } from "@/components/product/bulk_import_panel";
import { OnboardingMilestoneBar } from "@/components/product/onboarding_milestone_bar";
import { startConversationTurnAction } from "@/app/app/conversation/actions";

export interface ConversationHomeClientProps {
  workspaceId: string;
  workspaceName: string;
  initialRuns: WorkspaceOperatorRunRow[];
  defaultBoxId: string | null;
  hasNoBoxes: boolean;
  nowIso: string;
  userDisplayName: string | null;
  operatorEnabled: boolean;
}

export function ConversationHomeClient({
  workspaceId,
  workspaceName,
  initialRuns,
  defaultBoxId,
  hasNoBoxes,
  nowIso,
  userDisplayName,
  operatorEnabled,
}: ConversationHomeClientProps) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [importToast, setImportToast] = useState<string | null>(null);
  const [suggestionPending, setSuggestionPending] = useState(false);
  const [calloutDismissed, setCalloutDismissed] = useState<boolean>(false);
  const router = useRouter();

  async function startSuggestedPrompt(prompt: string) {
    if (suggestionPending) return;
    setSuggestionPending(true);
    try {
      const result = await startConversationTurnAction({
        prompt,
        boxId: defaultBoxId,
      });
      if (result.ok) {
        setActiveRunId(result.data.runId);
      }
    } finally {
      setSuggestionPending(false);
    }
  }

  // Fresh-workspace path: no boxes AND no past runs.
  const isFreshWorkspace = hasNoBoxes && initialRuns.length === 0;

  const hasNoRuns = initialRuns.length === 0 && activeRunId === null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Slim header — workspace name + New Note button */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">
          {workspaceName}
        </h1>
        <Link
          href="/app/notes/new"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
          New Note
        </Link>
      </header>

      {/* Conversation thread — flex-1, scrollable */}
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-4">
        {/* Show bulk importer for truly fresh workspaces */}
        {isFreshWorkspace ? (
          <div className="flex-1 overflow-y-auto">
            <div className="flex w-full flex-col gap-6 py-8">
              <OnboardingMilestoneBar />

              {importToast && (
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
                  <p className="text-sm font-medium text-foreground">
                    Workspace organized
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{importToast}</p>
                  <p className="mt-2 text-xs text-violet-700 dark:text-violet-400">
                    Atlas AI is ready — try asking:{" "}
                    <span className="italic">&quot;What did you find interesting about my notes?&quot;</span>{" "}
                    or{" "}
                    <span className="italic">&quot;Summarize my workspace.&quot;</span>
                  </p>
                </div>
              )}

              <BulkImportPanel
                workspaceId={workspaceId}
                onOrganized={(result) => {
                  setImportToast(result.summary);
                  router.refresh();
                }}
              />

              {!calloutDismissed && (
                <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground">How Atlas AI works</p>
                    <button
                      onClick={() => setCalloutDismissed(true)}
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <OnboardingCallout />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <WorkspaceConversation
              workspaceId={workspaceId}
              initialRuns={initialRuns}
              nowIso={nowIso}
              activeRunId={activeRunId}
              userDisplayName={userDisplayName}
            />
          </div>
        )}

        {/* Suggestion pills — only when no runs */}
        {hasNoRuns && !isFreshWorkspace && (
          <div className="flex flex-wrap gap-2 px-1 pb-2 pt-1">
            {[
              "What should I work on today?",
              "Summarize my workspace",
              "What changed recently?",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => startSuggestedPrompt(suggestion)}
                disabled={suggestionPending}
                className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* ConversationComposer — pinned at bottom */}
        <div className="shrink-0 border-t border-border py-3">
          <ConversationComposer
            workspaceId={workspaceId}
            defaultBoxId={defaultBoxId}
            hasHistory={initialRuns.length > 0}
            onRunStarted={setActiveRunId}
            operatorEnabled={operatorEnabled}
          />
        </div>
      </div>
    </div>
  );
}
