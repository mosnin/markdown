"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!userId || !UUID_REGEX.test(userId)) {
    return { ok: false, error: "Invalid user ID" };
  }

  await requireAdmin();

  const adminClient = createAdminClient();

  try {
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: "87600h", // 10 years — effectively permanent
    });

    if (error) {
      console.error("[admin/suspendUser] Error:", error);
      return { ok: false, error: "Failed to update user. Please try again." };
    }
  } catch (err) {
    console.error("[admin/suspendUser] Error:", err);
    return { ok: false, error: "Failed to update user. Please try again." };
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
  if (!userId || !UUID_REGEX.test(userId)) {
    return { ok: false, error: "Invalid user ID" };
  }

  await requireAdmin();

  const adminClient = createAdminClient();

  try {
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });

    if (error) {
      console.error("[admin/unsuspendUser] Error:", error);
      return { ok: false, error: "Failed to update user. Please try again." };
    }
  } catch (err) {
    console.error("[admin/unsuspendUser] Error:", err);
    return { ok: false, error: "Failed to update user. Please try again." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
