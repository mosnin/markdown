"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import {
  archiveAgent,
  unarchiveAgent,
  trashAgent,
  restoreAgent,
} from "@/server/services/lifecycle_service";
import { rollbackObjectToVersion } from "@/server/services/version_history_service";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Agent lifecycle ──────────────────────────────────────────────────────────

export async function archiveAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await archiveAgent(supabase, ctx.user.id, ctx.workspace.id, agentId);
    revalidatePath(`/app/agents/${agentId}`);
    revalidatePath("/app/agents");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to archive agent" };
  }
}

export async function unarchiveAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await unarchiveAgent(supabase, ctx.user.id, ctx.workspace.id, agentId);
    revalidatePath(`/app/agents/${agentId}`);
    revalidatePath("/app/agents");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to unarchive agent" };
  }
}

export async function trashAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await trashAgent(supabase, ctx.user.id, ctx.workspace.id, agentId);
    revalidatePath(`/app/agents/${agentId}`);
    revalidatePath("/app/agents");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash agent" };
  }
}

export async function restoreAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await restoreAgent(supabase, ctx.user.id, ctx.workspace.id, agentId);
    revalidatePath(`/app/agents/${agentId}`);
    revalidatePath("/app/agents");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to restore agent" };
  }
}

// ─── Agent rollback ───────────────────────────────────────────────────────────

/**
 * Roll back an agent to a prior version.
 * Creates a new version — history is never mutated.
 * Rollback is human-only: not exposed to connections or the API.
 *
 * Like skill rollback: reusable shared agents can be rolled back by their
 * human owner without a proposal. This is the one exception to the
 * proposal-only rule for reusable objects — the owner is explicitly
 * restoring to a known-good state, and the action is audited.
 */
export async function rollbackAgentAction(
  agentId: string,
  targetVersionId: string
): Promise<ActionResult<{ new_version_id: string; version_number: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const result = await rollbackObjectToVersion(
      supabase,
      ctx.user.id,
      ctx.workspace.id,
      "agent",
      agentId,
      targetVersionId
    );
    revalidatePath(`/app/agents/${agentId}`);
    return { ok: true, data: { new_version_id: result.new_version_id, version_number: result.version_number } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Rollback failed" };
  }
}
