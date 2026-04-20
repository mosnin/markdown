"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  checkOperatorQuota,
  type OperatorQuota,
} from "@/server/services/workspace_operator_quota_service";

export interface LoadOperatorQuotaResult {
  ok: boolean;
  /** Present when ok. */
  quota?: OperatorQuota;
  /** Present when not ok. */
  error?: string;
}

/**
 * Server action used by the Operator panel to preflight the current
 * user's quota before they hit "Generate Plan" / "Approve &amp; Run".
 *
 * Mirrors the shape the action layer uses at dispatch time so the UI can
 * proactively show a friendly "You've used all X runs" message and
 * disable the submit button with a tooltip, instead of letting the user
 * fill out a prompt only to be denied.
 */
export async function loadOperatorQuotaAction(): Promise<LoadOperatorQuotaResult> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const quota = await checkOperatorQuota(supabase, {
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
    });
    return { ok: true, quota };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load quota.",
    };
  }
}
