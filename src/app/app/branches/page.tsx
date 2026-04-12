import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listDraftBranches, listBranchHeads } from "@/server/services/branch_service";
import { PageHeader } from "@/components/product/page_header";
import { BranchesClient } from "./branches_client";

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
  const supabase = await createClient();
  const branches = await listDraftBranches(supabase, ctx.workspace.id);

  // Denormalize head counts so the page renders without a per-row
  // round trip.
  const rows = [];
  for (const b of branches) {
    const heads = await listBranchHeads(supabase, b.id);
    rows.push({ ...b, head_count: heads.length });
  }

  const canWrite = ctx.workspace.role !== "viewer";

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
          />
        </div>
      </div>
    </div>
  );
}
