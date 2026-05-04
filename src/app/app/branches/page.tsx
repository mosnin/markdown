// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listDraftBranches, listBranchHeads } from "@/server/services/branch_service";
import { getRetentionPolicy } from "@/server/services/branch_lifecycle_service";
import { canAdmin, requireAdvancedSurfaces } from "@/server/auth/require_role";
import { PageHeader } from "@/components/product/page_header";
import { BranchesClient } from "./branches_client";
import { PurgeOverlaysPanel } from "./purge_overlays_panel";

/**
 * Draft branches management page.
 *
 * Lists every branch in the active workspace (all statuses), exposes
 * create / switch / promote / discard actions, and renders the count
 * of heads per branch so users can see roughly what "will be
 * promoted" without opening a diff.
 *
 * Access: any workspace member sees the page. Write actions go
 * through role-gated server actions — viewers can see but can't
 * modify.
 */
export default async function BranchesPage() {
  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
  const supabase = await createClient();
  const branches = await listDraftBranches(supabase, ctx.workspace.id);

  // Denormalize head counts so the page renders without a per-row
  // round trip.
  // Resolve MCP client names for authored branches in one lookup.
  const authoredClientIds = branches
    .map((b) => b.authored_by_client_id)
    .filter((id): id is string => id !== null);
  const clientNameMap = new Map<string, string>();
  if (authoredClientIds.length > 0) {
    const { data: clients } = await supabase
      .from("oauth_clients")
      .select("client_id, name")
      .in("client_id", authoredClientIds);
    for (const c of clients ?? []) {
      clientNameMap.set(c.client_id, c.name);
    }
  }

  // Retention policy feeds the "will auto-discard in N days" indicator
  // on each stale row.
  const retention = await getRetentionPolicy(supabase, ctx.workspace.id);

  const rows = [];
  for (const b of branches) {
    const heads = await listBranchHeads(supabase, b.id);
    rows.push({
      ...b,
      head_count: heads.length,
      authored_by_client_name: b.authored_by_client_id
        ? clientNameMap.get(b.authored_by_client_id) ?? b.authored_by_client_id
        : null,
    });
  }

  const canWrite = ctx.workspace.role !== "viewer";
  const isAdmin = canAdmin(ctx.workspace.role);

  // For admins, count the purgeable overlay rows so the button label is
  // accurate without requiring a client-side fetch.
  let overlayCount = 0;
  if (isAdmin) {
    // Collect terminal branch IDs in this workspace.
    const { data: terminalBranches } = await supabase
      .from("draft_branches")
      .select("id")
      .eq("workspace_id", ctx.workspace.id)
      .in("status", ["discarded", "promoted"]);

    if (terminalBranches && terminalBranches.length > 0) {
      const ids = terminalBranches.map((b: { id: string }) => b.id);
      const { data: overlays } = await supabase
        .from("branch_package_metadata")
        .select("id")
        .in("branch_id", ids);
      overlayCount = (overlays ?? []).length;
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Draft branches"
        description="Safe exploratory editing for notes, files, skills, and agents. Every change you make on a branch stays off main until you promote it. Discard to throw the branch away — main is untouched either way."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
          <BranchesClient
            rows={rows}
            activeBranchId={ctx.activeBranchId}
            canWrite={canWrite}
            workspaceId={ctx.workspace.id}
            currentUserId={ctx.user.id}
            currentUserEmail={ctx.user.email ?? null}
            retentionPolicy={{
              enabled: retention.enabled,
              warn_after_idle_days: retention.warn_after_idle_days,
              auto_discard_after_days: retention.auto_discard_after_days,
            }}
          />
          {isAdmin && <PurgeOverlaysPanel overlayCount={overlayCount} />}
        </div>
      </div>
    </div>
  );
}
