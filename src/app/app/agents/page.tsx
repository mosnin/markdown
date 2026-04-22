import { Bot, History } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableAgents } from "@/server/repositories/agent_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import Link from "next/link";
import { AgentCreateDialog } from "@/components/product/agent_create_dialog";
import { AgentImportTrigger } from "@/components/product/agent_import_dialog";
import { AgentFromTemplateDialog } from "@/components/product/agent_from_template_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { AgentsListClient } from "@/components/product/agents_list_client";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAgents() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Bot className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">No workspace agents yet</p>
            <p className="text-xs text-muted-foreground">
              Workspace-level reusable agents appear here. Create one with the
              New agent button, or import a packaged agent. Box-local agents
              live inside their box.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AgentsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const [agents, boxes] = await Promise.all([
    listReusableAgents(supabase, ctx.workspace.id),
    listBoxesByWorkspace(supabase, ctx.workspace.id),
  ]);

  const allTags = [...new Set(agents.flatMap((a) => a.tags))].sort();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer />
      <WorkspaceLiveRefresh workspaceId={ctx.workspace.id} scope="library" />
      {/* Header */}
      <div className="border-b border-border bg-background px-4 pt-4 pb-4 md:px-6 md:pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Bot className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Agents</h1>
              <p className="text-xs text-muted-foreground">
                Workspace-level reusable agents shared across all boxes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/*
              Cross-workspace shortcut to the Workspace Operator run
              history. Surfacing it here so users discover that recent
              agent runs are inspectable rather than fire-and-forget.
            */}
            <Link
              href="/app/agents/runs"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent/40 transition-colors"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Recent operator runs
            </Link>
            <AgentFromTemplateDialog />
            <AgentImportTrigger />
            <AgentCreateDialog forceReusable />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {agents.length === 0 ? (
          <EmptyAgents />
        ) : (
          <AgentsListClient agents={agents} boxes={boxes} allTags={allTags} />
        )}
      </div>
    </div>
  );
}
