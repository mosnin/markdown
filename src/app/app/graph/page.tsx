import { Network } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listEntitiesByWorkspace } from "@/server/repositories/entity_repository";
import { listEdgesByWorkspace } from "@/server/repositories/entity_edge_repository";
import { KnowledgeGraphTabs } from "@/components/product/knowledge_graph_tabs";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { PageHeader } from "@/components/product/page_header";
import { EmptyState } from "@/components/product/empty_state";

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
      <PageHeader
        title="Knowledge graph"
        description="People, projects, concepts, and relationships extracted from your notes. Entities appear here as you write — click one to see every note it touches."
      />

      <div className="flex-1 overflow-auto">
        {entities.length === 0 ? (
          <EmptyState
            icon={<Network className="h-5 w-5" />}
            title="No entities extracted yet"
            description="Save a note with named content (people, projects, decisions) and the knowledge graph will populate within seconds. Requires EMBEDDING_API_KEY to be configured."
          />
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
