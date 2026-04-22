"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";

export type UpdateSubagentConfigResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Save the sub-agent settings for a skill — toggle, tool whitelist, and
 * max-turn cap. The backing columns live on `skills` (see migration
 * 20260425000001_subagents.sql). A skill with `is_subagent=true` is picked
 * up by list_skills_plugins and becomes callable from the Pog orchestrator
 * through invoke_subagent.
 *
 * Flow: auth -> verify skill is in caller's workspace -> UPDATE three
 * sub-agent columns. max_turns is clamped to [1, 100] to match the DB
 * check constraint `skills_subagent_max_turns_reasonable`.
 */
export async function updateSubagentConfigAction(
  skillId: string,
  config: {
    is_subagent: boolean;
    subagent_tools: string[] | null;
    subagent_max_turns: number | null;
  }
): Promise<UpdateSubagentConfigResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Verify the skill belongs to this workspace before updating —
    // RLS would also block a cross-workspace write, but an explicit
    // check gives a clean "Skill not found" error instead of a
    // confusing row-not-affected silent failure.
    const { data: skill, error: fetchError } = await supabase
      .from("skills")
      .select("id, workspace_id")
      .eq("id", skillId)
      .maybeSingle();

    if (fetchError || !skill || skill.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Skill not found" };
    }

    // Clamp max_turns to the DB-enforced range. Null is allowed (and
    // means "inherit system default of 20" per the v1 architecture).
    const clampedMaxTurns =
      config.subagent_max_turns === null
        ? null
        : Math.max(1, Math.min(100, Math.floor(config.subagent_max_turns)));

    const { error: updateError } = await supabase
      .from("skills")
      .update({
        is_subagent: config.is_subagent,
        subagent_tools: config.subagent_tools,
        subagent_max_turns: clampedMaxTurns,
      })
      .eq("id", skillId);

    if (updateError) {
      return { ok: false, error: updateError.message };
    }

    revalidatePath(`/app/skills/${skillId}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateSubagentConfigAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update sub-agent config",
    };
  }
}
