"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import {
  createGate,
  deleteGate,
  listGates,
  listRecentRunsByGate,
  rotateGateSecret,
  updateGate,
  type BranchPromotionGate,
  type GateRun,
} from "@/server/services/branch_promotion_gate_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Row shape rendered by the admin settings surface. Strips the secret
 * (we never expose it after creation) and attaches a compact run
 * summary for the "last 5 runs" badge.
 */
export interface PromotionGateRow {
  id: string;
  name: string;
  webhook_url: string;
  timeout_seconds: number;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
  recent_runs: Array<{ id: string; status: GateRun["status"]; created_at: string }>;
  passed_count: number;
  failed_count: number;
}

function stripSecret(gate: BranchPromotionGate): Omit<BranchPromotionGate, "secret"> {
  const { secret: _secret, ...rest } = gate;
  void _secret;
  return rest;
}

export async function listPromotionGatesAction(): Promise<ActionResult<PromotionGateRow[]>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const gates = await listGates(supabase, ctx.workspace.id);
    const runsByGate = await listRecentRunsByGate(supabase, ctx.workspace.id, 5);

    const rows: PromotionGateRow[] = gates.map((g) => {
      const runs = runsByGate[g.id] ?? [];
      const passed = runs.filter((r) => r.status === "passed").length;
      const failed = runs.filter((r) => r.status !== "passed" && r.status !== "pending").length;
      const stripped = stripSecret(g);
      return {
        id: stripped.id,
        name: stripped.name,
        webhook_url: stripped.webhook_url,
        timeout_seconds: stripped.timeout_seconds,
        status: stripped.status,
        created_at: stripped.created_at,
        updated_at: stripped.updated_at,
        recent_runs: runs.map((r) => ({
          id: r.id,
          status: r.status,
          created_at: r.created_at,
        })),
        passed_count: passed,
        failed_count: failed,
      };
    });

    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list gates" };
  }
}

export async function createPromotionGateAction(input: {
  name: string;
  webhookUrl: string;
  timeoutSeconds?: number;
}): Promise<ActionResult<{ gate: PromotionGateRow; secret: string }>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { gate: created, secret } = await createGate(
      supabase,
      ctx.workspace.id,
      ctx.user.id,
      input
    );

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "branch_promotion_gate",
      object_id: created.id,
      event_type: "branch_promotion_gate.created",
      metadata: { name: created.name, webhook_url: created.webhook_url },
    });

    revalidatePath("/app/settings/workspace/promotion_gates");
    const stripped = stripSecret(created);
    return {
      ok: true,
      data: {
        gate: {
          id: stripped.id,
          name: stripped.name,
          webhook_url: stripped.webhook_url,
          timeout_seconds: stripped.timeout_seconds,
          status: stripped.status,
          created_at: stripped.created_at,
          updated_at: stripped.updated_at,
          recent_runs: [],
          passed_count: 0,
          failed_count: 0,
        },
        secret,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create gate" };
  }
}

export async function updatePromotionGateAction(
  gateId: string,
  patch: { name?: string; webhookUrl?: string; timeoutSeconds?: number; status?: "active" | "disabled" }
): Promise<ActionResult<void>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    // Workspace-scope check — cross-workspace writes would bypass RLS
    // for service-role-free clients, so we verify at the action edge.
    const { data: existing } = await supabase
      .from("branch_promotion_gates")
      .select("workspace_id, name")
      .eq("id", gateId)
      .maybeSingle();
    if (!existing || existing.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Gate not found" };
    }
    await updateGate(supabase, gateId, patch);

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "branch_promotion_gate",
      object_id: gateId,
      event_type: "branch_promotion_gate.updated",
      metadata: { patch },
    });
    revalidatePath("/app/settings/workspace/promotion_gates");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update gate" };
  }
}

export async function deletePromotionGateAction(
  gateId: string
): Promise<ActionResult<void>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("branch_promotion_gates")
      .select("workspace_id, name")
      .eq("id", gateId)
      .maybeSingle();
    if (!existing || existing.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Gate not found" };
    }
    await deleteGate(supabase, gateId);
    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "branch_promotion_gate",
      object_id: gateId,
      event_type: "branch_promotion_gate.deleted",
      metadata: { name: existing.name },
    });
    revalidatePath("/app/settings/workspace/promotion_gates");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete gate" };
  }
}

export async function rotatePromotionGateSecretAction(
  gateId: string
): Promise<ActionResult<{ secret: string }>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("branch_promotion_gates")
      .select("workspace_id, name")
      .eq("id", gateId)
      .maybeSingle();
    if (!existing || existing.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Gate not found" };
    }
    const secret = await rotateGateSecret(supabase, gateId);
    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "branch_promotion_gate",
      object_id: gateId,
      event_type: "branch_promotion_gate.secret_rotated",
      metadata: { name: existing.name },
    });
    revalidatePath("/app/settings/workspace/promotion_gates");
    return { ok: true, data: { secret } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rotate secret" };
  }
}
