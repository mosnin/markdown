import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { listWriteProposalsByWorkspace } from "@/server/repositories/write_proposal_repository";
import { buildProposalPreview } from "@/server/services/write_proposal_service";
import { PageHeader } from "@/components/product/page_header";
import { ProposalsPanel } from "@/components/product/proposals_panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Connection } from "@/server/domain/types/connection";
import type { WriteProposal } from "@/server/domain/types/write_proposal";

/**
 * /app/proposals
 *
 * Human review surface for write proposals submitted by external connections.
 * Loads all proposals for the workspace (pending first) and the connection
 * records needed to display attribution.
 */
export default async function ProposalsPage() {
  const ctx = await requireAuthenticatedUser();
  const adminClient = createAdminClient();

  // Load all proposals for this workspace (most recent first)
  const allProposals = await listWriteProposalsByWorkspace(
    adminClient,
    ctx.workspace.id,
    { limit: 200 }
  );

  // Load connection records for attribution (one query, de-duped)
  const connectionIds = [...new Set(allProposals.map((p) => p.connection_id))];
  let connections: Connection[] = [];
  if (connectionIds.length > 0) {
    const { data } = await adminClient
      .from("connections")
      .select("*")
      .in("id", connectionIds);
    connections = (data as Connection[]) ?? [];
  }
  const connectionMap = new Map(connections.map((c) => [c.id, c]));

  // Build previews in parallel
  const items = await Promise.all(
    allProposals.map(async (proposal) => {
      const preview = await buildProposalPreview(adminClient, proposal);
      return {
        proposal: preview.proposal,
        connection: connectionMap.get(proposal.connection_id) ?? null,
        current_note: preview.current_note,
        preview_content: preview.preview_content,
      };
    })
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Write proposals"
        description="Review machine-proposed note changes before they are applied."
      />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <ProposalsPanel initialProposals={items} />
        </div>
      </ScrollArea>
    </div>
  );
}
