"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

// ─── Suspend user ─────────────────────────────────────────────────────────────

/**
 * Suspends a user by setting a 10-year ban duration (effectively permanent).
 *
 * Requires the caller to be an admin (checked via requireAdmin()).
 * Uses the Supabase service-role client to bypass RLS.
 */
export async function suspendUserAction(
  userId: string
): Promise<AdminActionResult> {
  await requireAdmin();

  const adminClient = createAdminClient();

  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: "87600h", // 10 years — effectively permanent
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

// ─── Unsuspend user ───────────────────────────────────────────────────────────

/**
 * Removes a ban from a user, restoring their access.
 *
 * Requires the caller to be an admin (checked via requireAdmin()).
 * Uses the Supabase service-role client to bypass RLS.
 */
export async function unsuspendUserAction(
  userId: string
): Promise<AdminActionResult> {
  await requireAdmin();

  const adminClient = createAdminClient();

  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
