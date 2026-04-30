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
import { PageHeader } from "@/components/product/page_header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/product/empty_state";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAgents() {
  return (
    <EmptyState
      icon={<Bot />}
      title="No workspace agents yet"
      description="Workspace-level reusable agents appear here. Create one with the New agent button, or import a packaged agent. Box-local agents live inside their box."
    />
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
      <PageHeader
        title="Agents"
        description="Workspace-level reusable agents shared across every box."
        actions={
          <>
            <Button variant="outline" size="sm" render={<Link href="/app/agents/runs" />}>
              <History data-icon="inline-start" />
              Recent runs
            </Button>
            <AgentFromTemplateDialog />
            <AgentImportTrigger />
            <AgentCreateDialog forceReusable />
          </>
        }
      />

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
