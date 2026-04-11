import { Bot } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableAgents } from "@/server/repositories/agent_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import Link from "next/link";
import { AgentTypeBadge } from "@/components/product/agent_type_badge";
import { AgentCreateDialog } from "@/components/product/agent_create_dialog";
import { AttachToBoxTrigger } from "@/components/product/attach_to_box_trigger";
import { AgentImportTrigger } from "@/components/product/agent_import_dialog";
import { cn } from "@/lib/utils";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAgents() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <Bot className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">No workspace agents yet</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Workspace-level reusable agents appear here. Box-local agents live inside their box.
        </p>
      </div>
    </div>
  );
}

// ─── Agent card ───────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  boxes,
}: {
  agent: {
    id: string;
    name: string;
    description: string | null;
    agent_type: string | null;
    tags: string[];
    canonical_format: string;
    status: string;
  };
  boxes: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="relative flex flex-col gap-0">
      <Link
        href={`/app/agents/${agent.id}`}
        className={cn(
          "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4",
          "transition-colors duration-150 hover:bg-accent/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground truncate flex-1">{agent.name}</span>
          {agent.agent_type && (
            <AgentTypeBadge agentType={agent.agent_type} subtle className="ml-auto shrink-0" />
          )}
        </div>
        {agent.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {agent.canonical_format}
          </span>
          {agent.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {agent.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="ml-auto">
            <AttachToBoxTrigger
              objectType="agent"
              objectId={agent.id}
              objectName={agent.name}
              boxes={boxes}
            />
          </div>
        </div>
      </Link>
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
      {/* Header */}
      <div className="border-b border-border bg-background px-6 pt-6 pb-4">
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
          <div className="mx-auto max-w-3xl px-6 py-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} boxes={boxes} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
