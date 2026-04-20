"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  WORKSPACE_PLANS,
  type WorkspacePlan,
} from "@/server/services/subscription_service";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Override plan ────────────────────────────────────────────────────────────

/**
 * Manually overrides a workspace's billing plan.
 *
 * Intended for comping accounts, resolving disputes, or granting trial access.
 * Updates workspace_subscriptions directly — does NOT interact with Creem.
 *
 * If no subscription row exists for the workspace, one is inserted with
 * status='active' and the override flag set.
 *
 * Requires the caller to be an admin (checked via requireAdmin()).
 * Uses the Supabase service-role client to bypass RLS.
 */
export async function overridePlanAction(
  workspaceId: string,
  plan: WorkspacePlan
): Promise<AdminActionResult> {
  if (!(WORKSPACE_PLANS as readonly string[]).includes(plan)) {
    return { ok: false, error: "Invalid plan" };
  }
  if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
    return { ok: false, error: "Invalid workspace ID" };
  }

  await requireAdmin();

  const adminClient = createAdminClient();

  try {
    // Check if a subscription row already exists for this workspace
    const { data: existing, error: fetchError } = await adminClient
      .from("workspace_subscriptions")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (fetchError) {
      console.error("[admin/overridePlan] Fetch error:", fetchError);
      return { ok: false, error: "Failed to update subscription. Please try again." };
    }

    if (existing) {
      // Update existing row — mark as manually overridden
      const { error } = await adminClient
        .from("workspace_subscriptions")
        .update({
          plan,
          manually_overridden: true,
        })
        .eq("workspace_id", workspaceId);

      if (error) {
        console.error("[admin/overridePlan] Update error:", error);
        return { ok: false, error: "Failed to update subscription. Please try again." };
      }
    } else {
      // Insert a new row for workspaces that have never had a subscription
      const { error } = await adminClient
        .from("workspace_subscriptions")
        .insert({
          workspace_id: workspaceId,
          plan,
          status: "active",
          manually_overridden: true,
        });

      if (error) {
        console.error("[admin/overridePlan] Insert error:", error);
        return { ok: false, error: "Failed to update subscription. Please try again." };
      }
    }
  } catch (err) {
    console.error("[admin/overridePlan] Error:", err);
    return { ok: false, error: "Failed to update subscription. Please try again." };
  }

  revalidatePath("/admin/subscriptions");
  return { ok: true };
}

// ─── Operator quota override ─────────────────────────────────────────────────

/**
 * Flips the `override_operator_quota` boolean on workspace_subscriptions.
 *
 * When true, `checkOperatorQuota()` always returns `allowed: true` for
 * this workspace regardless of tier or usage. Distinct from
 * `manually_overridden` (which only gates Creem sync).
 *
 * Admin-only. If no subscription row exists we create one on the fly
 * at the Free tier so the flag has somewhere to live.
 */
export async function setOperatorQuotaOverrideAction(
  workspaceId: string,
  overrideOperatorQuota: boolean
): Promise<AdminActionResult> {
  if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
    return { ok: false, error: "Invalid workspace ID" };
  }

  await requireAdmin();

  const adminClient = createAdminClient();

  try {
    const { data: existing, error: fetchError } = await adminClient
      .from("workspace_subscriptions")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (fetchError) {
      console.error(
        "[admin/setOperatorQuotaOverride] Fetch error:",
        fetchError
      );
      return {
        ok: false,
        error: "Failed to update quota override. Please try again.",
      };
    }

    if (existing) {
      const { error } = await adminClient
        .from("workspace_subscriptions")
        .update({ override_operator_quota: overrideOperatorQuota })
        .eq("workspace_id", workspaceId);

      if (error) {
        console.error(
          "[admin/setOperatorQuotaOverride] Update error:",
          error
        );
        return {
          ok: false,
          error: "Failed to update quota override. Please try again.",
        };
      }
    } else {
      const { error } = await adminClient
        .from("workspace_subscriptions")
        .insert({
          workspace_id: workspaceId,
          plan: "free",
          status: "active",
          override_operator_quota: overrideOperatorQuota,
        });

      if (error) {
        console.error(
          "[admin/setOperatorQuotaOverride] Insert error:",
          error
        );
        return {
          ok: false,
          error: "Failed to update quota override. Please try again.",
        };
      }
    }
  } catch (err) {
    console.error("[admin/setOperatorQuotaOverride] Error:", err);
    return {
      ok: false,
      error: "Failed to update quota override. Please try again.",
    };
  }

  revalidatePath("/admin/subscriptions");
  return { ok: true };
}
