// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import { Lightbulb } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { requireAdvancedSurfaces } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { listInsightsByWorkspace } from "@/server/repositories/insight_repository";
import { InsightsList } from "@/components/product/insights_list";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { PageHeader } from "@/components/product/page_header";
import { EmptyState } from "@/components/product/empty_state";

export default async function InsightsPage() {
  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
  const supabase = await createClient();
  const insights = await listInsightsByWorkspace(supabase, ctx.workspace.id, { limit: 500 });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer />
      <PageHeader
        title="Insights"
        description="Atomic claims, decisions, and open questions extracted from your notes."
      />
      <div className="flex-1 overflow-auto">
        {insights.length === 0 ? (
          <EmptyState
            icon={<Lightbulb />}
            title="No insights extracted yet"
            description="Insights appear as your notes are processed. Requires EMBEDDING_API_KEY to be configured and the extraction pipeline to be enabled."
          />
        ) : (
          <InsightsList insights={insights} />
        )}
      </div>
    </div>
  );
}
