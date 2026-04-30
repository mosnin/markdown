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
      <PageHeader
        eyebrow="Library"
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
