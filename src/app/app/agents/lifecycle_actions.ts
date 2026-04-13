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

// ─── Agent lifecycle ──────────────────────────────────────────────────────────

async function runAgentLifecycle(
  agentId: string,
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
  const guard = assertNonEmptyId(agentId, "agentId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Branch-aware lifecycle: record intent as a pending op instead
    // of mutating the canonical agents row. Main stays untouched
    // until promote. See `runLifecycleOnBranchOrMain`.
    if (ctx.activeBranchId) {
      const { runLifecycleOnBranchOrMain } = await import(
        "@/server/services/lifecycle_branch_router"
      );
      await runLifecycleOnBranchOrMain({
        supabase,
        branchId: ctx.activeBranchId,
        actorId: ctx.user.id,
        objectType: "agent",
        objectId: agentId,
        op,
      });
      revalidatePath(`/app/agents/${agentId}`);
      return { ok: true, data: undefined };
    }

    await withLifecycleChangeSet(
      supabase,
      {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        objectType: "agent",
        objectId: agentId,
        operation: op,
        beforeStatus,
        afterStatus: lifecycleStatusFor(op),
        summary: `${op} agent ${agentId.slice(0, 8)}`,
      },
      async () => { await perform(supabase, ctx.user.id, ctx.workspace.id); }
    );
    revalidatePath(`/app/agents/${agentId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : errorLabel };
  }
}

export async function archiveAgentAction(agentId: string): Promise<ActionResult> {
  return runAgentLifecycle(
    agentId, "archive",
    async (sb, u, w) => archiveAgent(sb, u, w, agentId),
    "active", "Failed to archive agent"
  );
}

export async function unarchiveAgentAction(agentId: string): Promise<ActionResult> {
  return runAgentLifecycle(
    agentId, "unarchive",
    async (sb, u, w) => unarchiveAgent(sb, u, w, agentId),
    "archived", "Failed to unarchive agent"
  );
}

export async function trashAgentAction(agentId: string): Promise<ActionResult> {
  return runAgentLifecycle(
    agentId, "trash",
    async (sb, u, w) => trashAgent(sb, u, w, agentId),
    "active", "Failed to trash agent"
  );
}

export async function restoreAgentAction(agentId: string): Promise<ActionResult> {
  return runAgentLifecycle(
    agentId, "restore_lifecycle",
    async (sb, u, w) => restoreAgent(sb, u, w, agentId),
    "trashed", "Failed to restore agent"
  );
}

// ─── Agent rollback ───────────────────────────────────────────────────────────

/**
 * Roll back an agent's canonical source to a prior version.
 * Human-only — not exposed to connections or the API.
 */
export async function rollbackAgentAction(
  agentId: string,
  targetVersionId: string
): Promise<ActionResult<{ new_version_id: string; version_number: number }>> {
  const guard = assertNonEmptyId(agentId, "agentId") ?? assertNonEmptyId(targetVersionId, "targetVersionId");
  if (guard) return guard;
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
