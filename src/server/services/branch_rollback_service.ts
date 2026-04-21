import { type SupabaseClient } from "@supabase/supabase-js";
import { getDraftBranch } from "./branch_service";
import { restoreFromChangeSet } from "./restore_service";
import { listChangeSetItems } from "./change_set_service";

/**
 * Branch rollback service.
 *
 * Exposes the existing restore engine to users for the specific case of
 * undoing a branch promotion. The flow is:
 *
 *   1. Validate the branch is in 'promoted' status.
 *   2. Find the change set that was created during promotion (via the
 *      change_sets table, matching origin='branch_promotion' and
 *      metadata.branch_id).
 *   3. Delegate to `restoreFromChangeSet` — the existing engine handles
 *      every object type, creates a child change set recording the
 *      rollback, and writes a restore_records row.
 *   4. Mark the branch as 'rolled_back' with the timestamp and a
 *      reference to the rollback's change set.
 *
 * Design decision: uses `requireWriteRole` (not admin-only) because
 * the operation is audited, reversible, and consistent with the
 * promote action's own role gate. Any write-capable member can undo
 * a promotion just as they can create one.
 */

export interface RollbackBranchResult {
  rolledBack: number;
  changeSetId: string;
}

export async function rollbackBranchPromotion(
  supabase: SupabaseClient,
  branchId: string,
  actorId: string,
  workspaceId?: string
): Promise<RollbackBranchResult> {
  // 1. Load and validate the branch.
  const branch = await getDraftBranch(supabase, branchId);
  if (!branch) {
    throw new Error("Branch not found");
  }
  // Defensive workspace scoping. RLS already prevents cross-workspace
  // access, but asserting here fails fast on caller misuse and keeps
  // the service contract explicit. Optional to preserve backward
  // compatibility with callers that haven't been updated yet.
  if (workspaceId && branch.workspace_id !== workspaceId) {
    throw new Error("Branch does not belong to this workspace");
  }
  // Reject mid-promotion branches: a `promoting` branch is in the
  // middle of its forward write-path and rolling it back now would
  // race the promote's own writes. Callers should wait for the promote
  // to complete (succeed → status='promoted', rollback allowed; fail →
  // status reverts, rollback not meaningful) before trying again.
  if (branch.status === "promoting") {
    throw new Error(
      "Branch is currently being promoted; retry after completion"
    );
  }
  if (branch.status !== "promoted") {
    throw new Error(
      `Cannot rollback branch in status '${branch.status}'. Only promoted branches can be rolled back.`
    );
  }

  // 2. Find the promotion change set.
  //    promoteBranch stores the branch_id in change_set metadata, and
  //    uses origin='branch_promotion' for full promotes or
  //    'branch_promotion_partial' for cherry-picked subsets. A branch may
  //    accumulate multiple partial-promote change sets before it's
  //    eventually fully promoted — we order by created_at DESC and pick the
  //    latest one matching this branch, which is the one the "Revert this
  //    promotion" button undoes. Older partial promotes can still be
  //    located via History if the user wants to roll those back too.
  const { data: changeSets } = await supabase
    .from("change_sets")
    .select("id, metadata, status, origin, created_at")
    .eq("workspace_id", branch.workspace_id)
    .in("origin", ["branch_promotion", "branch_promotion_partial"])
    .eq("status", "committed")
    .order("created_at", { ascending: false });

  const promotionCs = (changeSets ?? []).find(
    (cs: {
      id: string;
      metadata: Record<string, unknown>;
      status: string;
      origin?: string;
    }) =>
      cs.metadata &&
      (cs.metadata as Record<string, unknown>).branch_id === branchId
  );

  if (!promotionCs) {
    throw new Error(
      "Could not find the promotion change set for this branch. The promotion may have been recorded differently."
    );
  }

  // 3. Count the items that will be reverted (for the summary).
  const items = await listChangeSetItems(supabase, promotionCs.id);

  // 4. Delegate to the restore engine.
  const result = await restoreFromChangeSet(
    supabase,
    branch.workspace_id,
    actorId,
    promotionCs.id
  );

  if (!result.ok) {
    throw new Error(
      `Rollback failed: ${result.error ?? "Unknown error"}`
    );
  }

  // 5. Mark the branch as rolled_back.
  const { error: updateError } = await supabase
    .from("draft_branches")
    .update({
      status: "rolled_back",
      rolled_back_at: new Date().toISOString(),
      rollback_change_set_id: result.restoreChangeSetId ?? null,
    })
    .eq("id", branchId)
    .eq("status", "promoted");

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    rolledBack: items.length,
    changeSetId: result.restoreChangeSetId ?? "",
  };
}
