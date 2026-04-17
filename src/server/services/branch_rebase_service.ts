import { type SupabaseClient } from "@supabase/supabase-js";
import { getDraftBranch, type BranchHeadObjectType } from "./branch_service";
import { detectConflicts } from "./branch_conflict_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

/**
 * Branch rebase service.
 *
 * Provides three resolution strategies when a branch and main have
 * both changed the same objects:
 *
 *   - `keep_branch`: the user's branch content wins. We create a new
 *     version whose parent is main's current head so the branch
 *     effectively re-anchors on top of main, but retains its own
 *     content. The branch head pointer is updated.
 *
 *   - `keep_main`: main's content wins. The conflicting branch head
 *     row is removed so promote will not overwrite main's newer work.
 *
 *   - `rebase_branch_on_main`: identical to `keep_branch` — creates a
 *     new version with `parent_version_id = mainVersionId` and the
 *     branch's content. Re-anchors the branch on main's latest.
 *
 * All strategies record an audit event `branch.rebased` with the
 * strategy and count of affected objects.
 */

export type RebaseStrategy = "keep_branch" | "keep_main" | "rebase_branch_on_main";

export interface RebaseResult {
  rebased: number;
  conflicts: number;
}

export async function rebaseBranch(
  supabase: SupabaseClient,
  branchId: string,
  workspaceId: string,
  actorId: string,
  options: { strategy: RebaseStrategy }
): Promise<RebaseResult> {
  const branch = await getDraftBranch(supabase, branchId);
  if (!branch) throw new Error("Branch not found");
  if (branch.workspace_id !== workspaceId) throw new Error("Branch not in this workspace");
  // Both 'open' and 'rolled_back' branches may rebase: 'open' is the
  // usual pre-promote conflict resolution path; 'rolled_back' re-
  // anchors a previously-reverted branch so the user can edit and
  // re-promote it. Terminal states ('promoted', 'discarded',
  // 'promoting') are not rebasable.
  const startingStatus = branch.status;
  if (startingStatus !== "open" && startingStatus !== "rolled_back") {
    throw new Error(`Branch is ${startingStatus}, cannot rebase`);
  }

  const conflicts = await detectConflicts(supabase, branchId);
  if (conflicts.length === 0) {
    // No conflicts means no work to do. A rolled_back branch with no
    // conflicts still needs to transition back to 'open' so it
    // becomes re-promotable — otherwise the user is stuck with no
    // path forward after a revert. This is the "re-anchor a
    // rolled-back branch that main hasn't diverged from" case.
    if (startingStatus === "rolled_back") {
      await reopenRolledBackBranch(supabase, branchId, workspaceId, actorId, 0, options.strategy);
    }
    return { rebased: 0, conflicts: 0 };
  }

  let rebased = 0;

  for (const conflict of conflicts) {
    if (options.strategy === "keep_main") {
      await applyKeepMain(supabase, branchId, conflict.objectType, conflict.objectId);
      rebased++;
    } else {
      // Both 'keep_branch' and 'rebase_branch_on_main' re-anchor
      // the branch's content on top of main's latest version.
      await applyRebaseBranchOnMain(
        supabase,
        branchId,
        conflict.objectType,
        conflict.objectId,
        conflict.mainVersionId,
        conflict.branchVersionId
      );
      rebased++;
    }
  }

  await createAuditEvent(supabase, {
    workspace_id: workspaceId,
    actor_type: "user",
    actor_id: actorId,
    object_type: "draft_branch",
    object_id: branchId,
    event_type: "branch.rebased",
    metadata: {
      strategy: options.strategy,
      rebased_count: rebased,
      conflict_count: conflicts.length,
    },
  });

  // If the branch started in 'rolled_back', flip it back to 'open'
  // so promote becomes available again. This is the undo-a-revert
  // path — the user reverts, then rebases to re-anchor on the
  // latest main, then promotes again with fresh content.
  if (startingStatus === "rolled_back") {
    await reopenRolledBackBranch(
      supabase,
      branchId,
      workspaceId,
      actorId,
      rebased,
      options.strategy
    );
  }

  return { rebased, conflicts: conflicts.length };
}

/**
 * Flip a rolled_back branch back to 'open' after a successful
 * rebase, and record a `branch.reopened_via_rebase` audit event so
 * the revert→rebase→re-promote trail is legible in the audit log.
 *
 * The CAS on status (`.eq("status", "rolled_back")`) protects
 * against a concurrent caller having already reopened the branch.
 */
async function reopenRolledBackBranch(
  supabase: SupabaseClient,
  branchId: string,
  workspaceId: string,
  actorId: string,
  rebasedCount: number,
  strategy: RebaseStrategy
): Promise<void> {
  await supabase
    .from("draft_branches")
    .update({ status: "open" })
    .eq("id", branchId)
    .eq("status", "rolled_back");

  await createAuditEvent(supabase, {
    workspace_id: workspaceId,
    actor_type: "user",
    actor_id: actorId,
    object_type: "draft_branch",
    object_id: branchId,
    event_type: "branch.reopened_via_rebase",
    metadata: {
      strategy,
      rebased_count: rebasedCount,
      from_status: "rolled_back",
      to_status: "open",
    },
  });
}

/**
 * Keep main's version — delete the branch head so promote won't
 * overwrite main.
 */
async function applyKeepMain(
  supabase: SupabaseClient,
  branchId: string,
  objectType: BranchHeadObjectType,
  objectId: string
): Promise<void> {
  await supabase
    .from("branch_heads")
    .delete()
    .eq("branch_id", branchId)
    .eq("object_type", objectType)
    .eq("object_id", objectId);
}

/**
 * Re-anchor the branch on main. Creates a NEW version whose parent
 * is mainVersionId, copies the branch's content, and updates the
 * branch head to point at this new version. The old branch version
 * stays in the immutable version chain.
 */
async function applyRebaseBranchOnMain(
  supabase: SupabaseClient,
  branchId: string,
  objectType: BranchHeadObjectType,
  objectId: string,
  mainVersionId: string,
  branchVersionId: string
): Promise<void> {
  if (objectType === "note") {
    // Load the branch version content.
    const { data: branchVer } = await supabase
      .from("note_versions")
      .select("note_id, title, markdown_content, content_bytes, version_number")
      .eq("id", branchVersionId)
      .maybeSingle();
    if (!branchVer) throw new Error(`Branch version ${branchVersionId} not found`);

    // Load the main version to get its version_number for sequencing.
    const { data: mainVer } = await supabase
      .from("note_versions")
      .select("version_number")
      .eq("id", mainVersionId)
      .maybeSingle();

    const newVersionNumber = Math.max(
      (branchVer.version_number as number) ?? 1,
      (mainVer?.version_number as number) ?? 1
    ) + 1;

    // Create a new version that re-anchors on main.
    const { data: newVer, error } = await supabase
      .from("note_versions")
      .insert({
        note_id: branchVer.note_id,
        parent_version_id: mainVersionId,
        version_number: newVersionNumber,
        title: branchVer.title,
        markdown_content: branchVer.markdown_content,
        content_bytes: branchVer.content_bytes,
      })
      .select("id")
      .single();
    if (error || !newVer) throw new Error(error?.message ?? "Failed to create rebased version");

    // Update the branch head to point at the new version.
    await supabase
      .from("branch_heads")
      .update({ version_id: newVer.id })
      .eq("branch_id", branchId)
      .eq("object_type", objectType)
      .eq("object_id", objectId);
  } else {
    // file / skill / agent — object_versions table.
    const { data: branchVer } = await supabase
      .from("object_versions")
      .select("object_id, source_content, content_bytes, version_number")
      .eq("id", branchVersionId)
      .maybeSingle();
    if (!branchVer) throw new Error(`Branch version ${branchVersionId} not found`);

    const { data: mainVer } = await supabase
      .from("object_versions")
      .select("version_number")
      .eq("id", mainVersionId)
      .maybeSingle();

    const newVersionNumber = Math.max(
      (branchVer.version_number as number) ?? 1,
      (mainVer?.version_number as number) ?? 1
    ) + 1;

    const { data: newVer, error } = await supabase
      .from("object_versions")
      .insert({
        object_id: branchVer.object_id,
        parent_version_id: mainVersionId,
        version_number: newVersionNumber,
        source_content: branchVer.source_content,
        content_bytes: branchVer.content_bytes,
      })
      .select("id")
      .single();
    if (error || !newVer) throw new Error(error?.message ?? "Failed to create rebased version");

    await supabase
      .from("branch_heads")
      .update({ version_id: newVer.id })
      .eq("branch_id", branchId)
      .eq("object_type", objectType)
      .eq("object_id", objectId);
  }
}
