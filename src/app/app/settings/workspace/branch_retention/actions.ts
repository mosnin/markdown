"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult, requireWriteRoleResult } from "@/server/auth/require_role";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import {
  autoDiscardExpiredBranches,
  dismissStaleWarning,
  getRetentionPolicy,
  listStaleBranches,
  setRetentionPolicy,
  warnStaleBranches,
  type RetentionPolicy,
  type RetentionPolicyPatch,
  type StaleBranchRow,
} from "@/server/services/branch_lifecycle_service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Admin-only mutation of the workspace retention policy. Gated by
 * `requireAdminRoleResult()` — viewers and regular members see the
 * page read-only but can't save a change.
 */
export async function updateRetentionPolicyAction(
  patch: RetentionPolicyPatch
): Promise<ActionResult<RetentionPolicy>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const policy = await setRetentionPolicy(
      supabase,
      ctx.workspace.id,
      ctx.user.id,
      patch
    );

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "branch.retention_policy_updated",
      metadata: {
        enabled: policy.enabled,
        warn_after_idle_days: policy.warn_after_idle_days,
        auto_discard_after_days: policy.auto_discard_after_days,
      },
    });

    revalidatePath("/app/settings/workspace/branch_retention");
    return { ok: true, data: policy };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save policy",
    };
  }
}

/**
 * Read the workspace policy. Any write-capable member can read — this
 * is the initial-data fetch for the client UI.
 */
export async function getRetentionPolicyAction(): Promise<
  ActionResult<RetentionPolicy>
> {
  const gate = await requireWriteRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;
  try {
    const supabase = await createClient();
    const policy = await getRetentionPolicy(supabase, ctx.workspace.id);
    return { ok: true, data: policy };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to read policy",
    };
  }
}

/**
 * Stale open branches in the caller's workspace. Any write-capable
 * member can call this so the panel works for non-admins too; the
 * per-branch actions still gate on role.
 */
export async function listStaleBranchesAction(
  idleDays?: number
): Promise<ActionResult<StaleBranchRow[]>> {
  const gate = await requireWriteRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const rows = await listStaleBranches(supabase, ctx.workspace.id, {
      idleDays,
    });
    return { ok: true, data: rows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list stale branches",
    };
  }
}

/**
 * Admin action: run the warn + auto-discard loops once against this
 * workspace. Returns the counts so the UI can confirm what happened.
 */
export async function runCleanupNowAction(): Promise<
  ActionResult<{ warned: number; discarded: number }>
> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const warned = await warnStaleBranches(supabase, ctx.workspace.id);
    const discarded = await autoDiscardExpiredBranches(
      supabase,
      ctx.workspace.id
    );

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "branch.cleanup_run",
      metadata: { warned, discarded, invoked_from: "admin_ui" },
    });

    revalidatePath("/app/settings/workspace/branch_retention");
    revalidatePath("/app/branches");
    return { ok: true, data: { warned, discarded } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Cleanup run failed",
    };
  }
}

/**
 * "Keep this branch active" — clears the stale warning. Any
 * write-capable member can dismiss the warning on any branch they can
 * see (same bar as discard / promote, which work the same way).
 */
export async function dismissStaleWarningAction(
  branchId: string
): Promise<ActionResult> {
  const gate = await requireWriteRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { data: branch } = await supabase
      .from("draft_branches")
      .select("workspace_id")
      .eq("id", branchId)
      .maybeSingle();
    if (!branch || branch.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Branch not found" };
    }
    await dismissStaleWarning(supabase, branchId, ctx.user.id);

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "draft_branch",
      object_id: branchId,
      event_type: "branch.stale_warning_dismissed",
      metadata: {},
    });

    revalidatePath("/app/settings/workspace/branch_retention");
    revalidatePath("/app/branches");
    revalidatePath(`/app/branches/${branchId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to dismiss warning",
    };
  }
}
