"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";
import { WorkspaceConversation } from "@/components/product/workspace/workspace_conversation";
import { ConversationComposer } from "@/components/product/conversation_composer";
import { BulkImportPanel } from "@/components/product/bulk_import_panel";
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
      {/* Slim header — workspace name only */}
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">
          {workspaceName}
        </h1>
      </header>

      {/* Conversation thread — flex-1, scrollable */}
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-4">
        {isFreshWorkspace ? (
          <div className="flex-1 overflow-y-auto">
            <div className="flex w-full flex-col gap-6 py-8">
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

              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <p className="text-2xl font-semibold tracking-tight text-foreground">
                  What would you like to work on?
                </p>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Atlas AI knows your notes and can research, write, or organize anything in your workspace.
                </p>
              </div>
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

        {/* Lighter empty state when workspace has boxes but no AI runs yet */}
        {hasNoRuns && !isFreshWorkspace && (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="text-lg font-medium text-foreground/80">
              Ask Atlas AI anything about your workspace.
            </p>
          </div>
        )}

        {/* ConversationComposer — pinned at bottom */}
        <div className="shrink-0 border-t border-border px-4 pb-6 pt-2">
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
