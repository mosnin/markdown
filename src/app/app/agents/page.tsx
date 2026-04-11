import { Bot } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listReusableAgents } from "@/server/repositories/agent_repository";
import Link from "next/link";
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
        <p className="text-xs text-muted-foreground">
          Workspace-level reusable agents will appear here. Box-local agents live inside their box.
        </p>
      </div>
    </div>
  );
}

// ─── Agent card ───────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: { id: string; name: string; description: string | null; agent_type: string | null; tags: string[] } }) {
  return (
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
        <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
        {agent.agent_type && (
          <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {agent.agent_type}
          </span>
        )}
      </div>
      {agent.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
      )}
      {agent.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {agent.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AgentsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const agents = await listReusableAgents(supabase, ctx.workspace.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border bg-background px-6 pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <Bot className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Agents</h1>
            <p className="text-xs text-muted-foreground">Workspace-level reusable agents shared across all boxes</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {agents.length === 0 ? (
          <EmptyAgents />
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
