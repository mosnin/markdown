import { Lightbulb } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listInsightsByWorkspace } from "@/server/repositories/insight_repository";
import { InsightsList } from "@/components/product/insights_list";
import { ActiveBranchBannerServer } from "@/components/product/active_branch_banner_server";
import { PageHeader } from "@/components/product/page_header";

export default async function InsightsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const insights = await listInsightsByWorkspace(supabase, ctx.workspace.id, { limit: 500 });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ActiveBranchBannerServer />
      <PageHeader
        eyebrow="Knowledge"
        title="Insights"
        description="Atomic claims, decisions, and open questions extracted from your notes."
      />
      <div className="flex-1 overflow-auto">
        {insights.length === 0 ? (
          <div className="mx-auto w-full max-w-7xl px-6 py-10">
            <div className="rounded-lg border border-dashed border-border bg-card/40 p-8">
              <Lightbulb className="h-5 w-5 text-muted-foreground mb-2" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground mb-1">No insights extracted yet</p>
              <p className="text-xs text-muted-foreground">
                Insights appear as your notes are processed. Requires EMBEDDING_API_KEY to be configured and the extraction pipeline to be enabled.
              </p>
            </div>
          </div>
        ) : (
          <InsightsList insights={insights} />
        )}
      </div>
    </div>
  );
}
