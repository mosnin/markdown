"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import {
  archiveSkill,
  unarchiveSkill,
  trashSkill,
  restoreSkill,
} from "@/server/services/lifecycle_service";
import { rollbackObjectToVersion } from "@/server/services/version_history_service";
import {
  withLifecycleChangeSet,
  lifecycleStatusFor,
} from "@/server/services/lifecycle_change_set";
import { type ChangeSetItemOperation } from "@/server/services/change_set_service";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function assertNonEmptyId(id: string, label: string): { ok: false; error: string } | null {
  if (!id || id.trim() === "") return { ok: false, error: `${label} is required` };
  return null;
}

// ─── Skill lifecycle ──────────────────────────────────────────────────────────

async function runSkillLifecycle(
  skillId: string,
  op: Extract<
    ChangeSetItemOperation,
    "archive" | "unarchive" | "trash" | "restore_lifecycle"
  >,
  perform: (
    sb: Awaited<ReturnType<typeof createClient>>,
    userId: string,
    workspaceId: string
  ) => Promise<unknown>,
  beforeStatus: string,
  errorLabel: string
): Promise<ActionResult> {
  const guard = assertNonEmptyId(skillId, "skillId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Branch-aware lifecycle: record intent as a pending op instead
    // of mutating the canonical skills row. See
    // `runLifecycleOnBranchOrMain`.
    if (ctx.activeBranchId) {
      const { runLifecycleOnBranchOrMain } = await import(
        "@/server/services/lifecycle_branch_router"
      );
      await runLifecycleOnBranchOrMain({
        supabase,
        branchId: ctx.activeBranchId,
        actorId: ctx.user.id,
        objectType: "skill",
        objectId: skillId,
        op,
      });
      revalidatePath(`/app/skills/${skillId}`);
      revalidatePath("/app/skills");
      return { ok: true, data: undefined };
    }

    await withLifecycleChangeSet(
      supabase,
      {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        objectType: "skill",
        objectId: skillId,
        operation: op,
        beforeStatus,
        afterStatus: lifecycleStatusFor(op),
        summary: `${op} skill ${skillId.slice(0, 8)}`,
      },
      async () => { await perform(supabase, ctx.user.id, ctx.workspace.id); }
    );
    revalidatePath(`/app/skills/${skillId}`);
    revalidatePath("/app/skills");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : errorLabel };
  }
}

export async function archiveSkillAction(skillId: string): Promise<ActionResult> {
  return runSkillLifecycle(
    skillId, "archive",
    async (sb, u, w) => archiveSkill(sb, u, w, skillId),
    "active", "Failed to archive skill"
  );
}

export async function unarchiveSkillAction(skillId: string): Promise<ActionResult> {
  return runSkillLifecycle(
    skillId, "unarchive",
    async (sb, u, w) => unarchiveSkill(sb, u, w, skillId),
    "archived", "Failed to unarchive skill"
  );
}

export async function trashSkillAction(skillId: string): Promise<ActionResult> {
  return runSkillLifecycle(
    skillId, "trash",
    async (sb, u, w) => trashSkill(sb, u, w, skillId),
    "active", "Failed to trash skill"
  );
}

export async function restoreSkillAction(skillId: string): Promise<ActionResult> {
  return runSkillLifecycle(
    skillId, "restore_lifecycle",
    async (sb, u, w) => restoreSkill(sb, u, w, skillId),
    "trashed", "Failed to restore skill"
  );
}

// ─── Skill rollback ───────────────────────────────────────────────────────────

/**
 * Roll back a skill's canonical source to a prior version.
 * Human-only — not exposed to connections or the API.
 */
export async function rollbackSkillAction(
  skillId: string,
  targetVersionId: string
): Promise<ActionResult<{ new_version_id: string; version_number: number }>> {
  const guard = assertNonEmptyId(skillId, "skillId") ?? assertNonEmptyId(targetVersionId, "targetVersionId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const result = await rollbackObjectToVersion(
      supabase,
      ctx.user.id,
      ctx.workspace.id,
      "skill",
      skillId,
      targetVersionId
    );
    revalidatePath(`/app/skills/${skillId}`);
    return { ok: true, data: { new_version_id: result.new_version_id, version_number: result.version_number } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Rollback failed" };
  }
}
