// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { requireAdvancedSurfaces } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { getDraftBranch } from "@/server/services/branch_service";
import { getBranchDiff } from "@/server/services/branch_diff_service";
import { getRetentionPolicy } from "@/server/services/branch_lifecycle_service";
import { listReviews } from "@/server/services/branch_review_service";
import { listCommentsForBranch } from "@/server/services/branch_comment_service";
import { PageHeader } from "@/components/product/page_header";
import { BranchDetailClient } from "./branch_detail_client";

/**
 * Branch preview / detail page.
 *
 * Shows every object the branch has edited with a per-head diff so
 * the user can inspect what will change before promoting. Users can
 * promote, discard, or switch active branch from this page without
 * going back to the list.
 *
 * Access: any workspace member reads. Promote / discard require
 * write role, enforced at the server-action layer.
 */
export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ branch_id: string }>;
}) {
  const { branch_id } = await params;
  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
  const supabase = await createClient();

  const branch = await getDraftBranch(supabase, branch_id);
  if (!branch || branch.workspace_id !== ctx.workspace.id) notFound();

  const diff = await getBranchDiff(supabase, branch_id, ctx.workspace.id);
  if (!diff) notFound();

  const canWrite = ctx.workspace.role !== "viewer";
  const isActive = ctx.activeBranchId === branch_id;
  const isAuthor = branch.created_by === ctx.user.id;

  // Resolve MCP client name for the "authored by" badge.
  let authoredByClientName: string | null = null;
  if (branch.authored_by_client_id) {
    const { data: client } = await supabase
      .from("oauth_clients")
      .select("name")
      .eq("client_id", branch.authored_by_client_id)
      .maybeSingle();
    authoredByClientName = client?.name ?? branch.authored_by_client_id;
  }

  // Review workflow data — all workspace members can see this, and
  // it's cheap to load. Reviews is typically small (one row per
  // reviewer on a branch); comments may be larger but are grouped
  // per-diff-row in the client.
  const reviews = await listReviews(supabase, branch_id);
  const comments = await listCommentsForBranch(supabase, branch_id);

  // Retention policy for the stale banner (Feature #8).
  const retention = await getRetentionPolicy(supabase, ctx.workspace.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={branch.name}
        description={
          branch.description ??
          "Review every object this branch has edited. Promote advances main to the branch state for the whole set; discard leaves main untouched."
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 space-y-5">
          <Link
            href="/app/branches"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-fast"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            All branches
          </Link>

          <BranchDetailClient
            branch={branch}
            diff={diff}
            canWrite={canWrite}
            isActive={isActive}
            isAuthor={isAuthor}
            authoredByClientName={authoredByClientName}
            reviews={reviews}
            comments={comments}
            currentUserId={ctx.user.id}
            currentUserEmail={ctx.user.email ?? null}
            retentionPolicy={{
              enabled: retention.enabled,
              warn_after_idle_days: retention.warn_after_idle_days,
              auto_discard_after_days: retention.auto_discard_after_days,
            }}
          />
        </div>
      </div>
    </div>
  );
}
