import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { listWriteProposalsByWorkspace } from "@/server/repositories/write_proposal_repository";
import { buildProposalPreview } from "@/server/services/write_proposal_service";
import { PageHeader } from "@/components/product/page_header";
import { ProposalsPanel } from "@/components/product/proposals_panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CircleDashed } from "lucide-react";
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

  const pendingCount = allProposals.filter((p) => p.status === "pending").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="AI Proposals"
        description="Review machine-proposed note changes before they are applied to your workspace."
        actions={
          pendingCount > 0 ? (
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 text-xs font-medium">
              {pendingCount} pending
            </Badge>
          ) : undefined
        }
      />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-lg border border-dashed border-border">
              <CircleDashed
                className="mb-4 h-10 w-10 text-muted-foreground/30"
                aria-hidden="true"
              />
              <h3 className="text-base font-semibold text-foreground">
                No proposals yet
              </h3>
              <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                When connected integrations submit write proposals, they will appear
                here for your review.
              </p>
            </div>
          ) : (
            <ProposalsPanel initialProposals={items} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
