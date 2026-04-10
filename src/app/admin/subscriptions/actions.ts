"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

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
  plan: "free" | "pro"
): Promise<AdminActionResult> {
  await requireAdmin();

  const adminClient = createAdminClient();

  // Check if a subscription row already exists for this workspace
  const { data: existing, error: fetchError } = await adminClient
    .from("workspace_subscriptions")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: fetchError.message };
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
      return { ok: false, error: error.message };
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
      return { ok: false, error: error.message };
    }
  }

  revalidatePath("/admin/subscriptions");
  return { ok: true };
}
