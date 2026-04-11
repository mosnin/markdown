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

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Skill lifecycle ──────────────────────────────────────────────────────────

export async function archiveSkillAction(skillId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await archiveSkill(supabase, ctx.user.id, ctx.workspace.id, skillId);
    revalidatePath(`/app/skills/${skillId}`);
    revalidatePath("/app/skills");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to archive skill" };
  }
}

export async function unarchiveSkillAction(skillId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await unarchiveSkill(supabase, ctx.user.id, ctx.workspace.id, skillId);
    revalidatePath(`/app/skills/${skillId}`);
    revalidatePath("/app/skills");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to unarchive skill" };
  }
}

export async function trashSkillAction(skillId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await trashSkill(supabase, ctx.user.id, ctx.workspace.id, skillId);
    revalidatePath(`/app/skills/${skillId}`);
    revalidatePath("/app/skills");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash skill" };
  }
}

export async function restoreSkillAction(skillId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await restoreSkill(supabase, ctx.user.id, ctx.workspace.id, skillId);
    revalidatePath(`/app/skills/${skillId}`);
    revalidatePath("/app/skills");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to restore skill" };
  }
}

// ─── Skill rollback ───────────────────────────────────────────────────────────

/**
 * Roll back a skill to a prior version.
 * Creates a new version — history is never mutated.
 * Rollback is human-only: not exposed to connections or the API.
 *
 * Note: for reusable shared skills, rollback still requires human action
 * and is audited as such. The human-controlled rollback is the one exception
 * where a reusable shared object can be mutated without a proposal — because
 * the human owner is explicitly choosing to restore to a known-good state.
 */
export async function rollbackSkillAction(
  skillId: string,
  targetVersionId: string
): Promise<ActionResult<{ new_version_id: string; version_number: number }>> {
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
