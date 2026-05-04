"use server";

import { revalidatePath } from "next/cache";

import { requireAdminRoleResult } from "@/server/auth/require_role";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Mark a `perf_alerts` row resolved.
 *
 * Admin-only — gated by `requireAdminRoleResult` plus the RLS policy on
 * `perf_alerts` (admins-only update). The form is rendered inline on the
 * dashboard, so we revalidate the dashboard path on success.
 */
export async function resolvePerfAlertAction(
  formData: FormData,
): Promise<ActionResult> {
  const guard = await requireAdminRoleResult();
  if (!guard.ok) return guard;

  const id = formData.get("alertId");
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, error: "Missing alert id." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("perf_alerts")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: guard.ctx.user.id,
    })
    .eq("id", id)
    .is("resolved_at", null);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/app/admin/performance");
  return { ok: true, data: undefined };
}

/**
 * Form-action variant that returns `void`. React 19's
 * `<form action={…}>` expects a void-returning function; the typed
 * variant above is preserved for callers that want the ActionResult
 * envelope. We swallow errors here because the dashboard always
 * re-renders from the latest server data on revalidation — the row
 * either disappears (success) or stays (failure), and the admin retries.
 */
export async function resolvePerfAlertFormAction(
  formData: FormData,
): Promise<void> {
  await resolvePerfAlertAction(formData);
}
