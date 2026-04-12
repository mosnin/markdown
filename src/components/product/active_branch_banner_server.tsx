import { getRequestContext } from "@/server/auth/get_request_context";
import { createClient } from "@/lib/supabase/server";
import { resolveBranchVersion } from "@/server/services/branch_service";
import { ActiveBranchBanner } from "./active_branch_banner";

/**
 * Server component wrapper around ActiveBranchBanner.
 *
 * Each detail page (notes, files, skills, agents) drops one of these
 * in at the top of its return. The component fetches the current
 * active branch name + whether the branch actually has a head for
 * this specific object, so the banner only appears when the user is
 * meaningfully editing on a branch for THIS object. If the user is
 * on a branch but hasn't edited this object yet, the banner still
 * shows — it's the intent signal that matters, not per-object state.
 *
 * Passing an objectType + objectId is optional. When omitted, the
 * banner just reports "you are on branch X" regardless of whether
 * this screen has a head.
 */
export async function ActiveBranchBannerServer({
  objectType,
  objectId,
}: {
  objectType?: "note" | "file" | "skill" | "agent";
  objectId?: string;
}) {
  const ctx = await getRequestContext();
  if (!ctx.activeBranchId) return null;

  const supabase = await createClient();
  const { data: branch } = await supabase
    .from("draft_branches")
    .select("id, name, status, workspace_id")
    .eq("id", ctx.activeBranchId)
    .maybeSingle();
  if (!branch || branch.status !== "open" || !ctx.workspace ||
      branch.workspace_id !== ctx.workspace.id) {
    return null;
  }

  // Presence check — purely so we can optionally decorate the banner
  // with "head exists for this object" info later. Intentionally
  // unused for now.
  if (objectType && objectId) {
    void (await resolveBranchVersion(supabase, ctx.activeBranchId, objectType, objectId));
  }

  return <ActiveBranchBanner branchName={branch.name} branchId={branch.id} />;
}
