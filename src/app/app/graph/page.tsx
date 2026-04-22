import { Network } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listEntitiesByWorkspace } from "@/server/repositories/entity_repository";
import { listEdgesByWorkspace } from "@/server/repositories/entity_edge_repository";
import { KnowledgeGraphTabs } from "@/components/product/knowledge_graph_tabs";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";

export default async function GraphPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const [entities, edges] = await Promise.all([
    listEntitiesByWorkspace(supabase, ctx.workspace.id, { limit: 500 }),
    listEdgesByWorkspace(supabase, ctx.workspace.id, { limit: 2000 }),
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer />
      <div className="border-b border-border bg-background px-4 pt-4 pb-4 md:px-6 md:pt-6">
        <div className="flex items-center gap-2.5">
          <Network className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Knowledge graph</h1>
            <p className="text-xs text-muted-foreground">
              People, projects, concepts, and relationships extracted from your notes. Entities appear here as you write — click one to see every note it touches.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {entities.length === 0 ? (
          <div className="mx-auto w-full max-w-7xl px-6 py-10">
            <div className="rounded-lg border border-dashed border-border bg-card/40 p-8">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Network className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">No entities extracted yet</p>
                  <p className="text-xs text-muted-foreground">
                    Save a note with named content (people, projects, decisions) and the knowledge graph will populate within seconds. Requires <code className="rounded bg-muted px-1 font-mono">EMBEDDING_API_KEY</code> to be configured.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <KnowledgeGraphTabs
            entities={entities}
            edges={edges.map((e) => ({
              source: e.source_entity_id,
              target: e.target_entity_id,
              edge_type: e.edge_type,
              confidence: e.confidence,
            }))}
          />
        )}
      </div>
    </div>
  );
}
