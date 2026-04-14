import { Bot } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableAgents } from "@/server/repositories/agent_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { AgentCreateDialog } from "@/components/product/agent_create_dialog";
import { AgentImportTrigger } from "@/components/product/agent_import_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";
import { AgentsLibraryView } from "@/components/product/agents_library_view";

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
          <AgentImportTrigger />
          <AgentCreateDialog forceReusable />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {agents.length === 0 ? (
          <EmptyAgents />
        ) : (
          <div className="mx-auto w-full max-w-7xl px-6 py-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                {agents.length} agent{agents.length === 1 ? "" : "s"}
              </p>
            </div>
            <AgentsLibraryView agents={agents} boxes={boxes} />
          </div>
        )}
      </div>
    </div>
  );
}
