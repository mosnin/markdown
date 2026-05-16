import { Bot, History } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableAgents } from "@/server/repositories/agent_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import Link from "next/link";
import { AgentCreateDialog } from "@/components/product/agents/agent_create_dialog";
import { AgentImportTrigger } from "@/components/product/agents/agent_import_dialog";
import { AgentFromTemplateDialog } from "@/components/product/agents/agent_from_template_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace/workspace_live_refresh";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { AgentsListClient } from "@/components/product/agents/agents_list_client";
import { AgentsPageHeader } from "@/components/product/agents/agents_page_header";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAgents() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="rounded-lg border border-border p-3">
        <Bot className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium">No workspace agents yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create one with the New agent button, or start from a template.
        </p>
      </div>
      <AgentCreateDialog forceReusable />
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

      {/* Animated page header — client component */}
      <AgentsPageHeader>
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
      </AgentsPageHeader>

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
