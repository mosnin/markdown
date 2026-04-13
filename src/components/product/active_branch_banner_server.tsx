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

  // For package-style objects (skill / agent) surface a stronger
  // signal: count the package draft's changed elements (canonical
  // source + child file heads + metadata overlay) so the banner can
  // say "3 changes pending on this package" instead of just "editing
  // on branch X". For note / file the simpler message is fine.
  let packageNote: string | null = null;
  if (objectType && objectId) {
    if (objectType === "skill" || objectType === "agent") {
      const { getPackageDraftState } = await import(
        "@/server/services/package_branch_service"
      );
      const draft = await getPackageDraftState(
        supabase,
        ctx.activeBranchId,
        objectType,
        objectId
      );
      if (draft) {
        const parts: string[] = [];
        if (draft.canonicalSourceVersionId) parts.push("canonical source");
        if (draft.childHeads.length > 0) {
          parts.push(`${draft.childHeads.length} child file${draft.childHeads.length === 1 ? "" : "s"}`);
        }
        if (draft.metadataOverlay) parts.push("metadata");
        if (parts.length > 0) {
          packageNote = `This package has branch changes: ${parts.join(" · ")}.`;
        }
      }
    } else {
      void (await resolveBranchVersion(supabase, ctx.activeBranchId, objectType, objectId));
    }
  }

  return (
    <ActiveBranchBanner
      branchName={branch.name}
      branchId={branch.id}
      packageNote={packageNote}
    />
  );
}
