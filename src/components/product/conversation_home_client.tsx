"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, X } from "lucide-react";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";
import { WorkspaceConversation } from "@/components/product/workspace_conversation";
import { ConversationComposer } from "@/components/product/conversation_composer";
import { OnboardingCallout } from "@/components/product/onboarding_callout";
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

  // Fresh-workspace path: no boxes AND no past runs. The user has nothing
  // to chat about yet, so the centerpiece becomes the bulk importer —
  // paste notes, get an organized workspace, then start chatting.
  const isFreshWorkspace = hasNoBoxes && initialRuns.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
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

      {isFreshWorkspace ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
            <div className="text-center">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                Bring your notes — Pog will organize them
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Paste a markdown blob or drop a folder of <code className="rounded bg-muted px-1 py-0.5 text-xs">.md</code> files.
                We embed each note, group them by meaning, and create boxes
                automatically. You&apos;ll have a navigable workspace in seconds.
              </p>
            </div>

            {importToast && (
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
                <p className="text-sm font-medium text-foreground">
                  Workspace organized
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{importToast}</p>
                <p className="mt-2 text-xs text-violet-700 dark:text-violet-400">
                  Pog is ready — try asking: <span className="italic">&quot;What did you find interesting about my notes?&quot;</span> or <span className="italic">&quot;Summarize my workspace.&quot;</span>
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
                  <p className="text-xs font-medium text-muted-foreground">How Pog works</p>
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
        <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-4">
          {hasNoBoxes && (
            <div className="border-b border-border bg-muted/20 px-2 py-2 text-xs text-muted-foreground">
              No boxes yet — <Link href="/app/workspaces" className="underline hover:text-foreground">create one</Link> so Pog can draft notes for you.
            </div>
          )}
          <div className="min-h-0 flex-1">
            <WorkspaceConversation
              workspaceId={workspaceId}
              initialRuns={initialRuns}
              nowIso={nowIso}
              activeRunId={activeRunId}
              userDisplayName={userDisplayName}
            />
          </div>

          {initialRuns.length === 0 && !activeRunId && (
            <div className="flex flex-wrap gap-2 px-1 pb-2 pt-1">
              {[
                "What should I work on today?",
                "Summarize my workspace",
                "What's changed recently?",
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

          <div className="shrink-0 border-t border-border py-3">
            <ConversationComposer
              workspaceId={workspaceId}
              defaultBoxId={defaultBoxId}
              hasHistory={initialRuns.length > 0}
              onRunStarted={setActiveRunId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
