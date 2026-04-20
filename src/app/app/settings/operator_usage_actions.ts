"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  getWorkspaceUsageForMonth,
  sumOperatorUsage,
  type OperatorUsageTotals,
} from "@/server/services/workspace_operator_usage_service";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface OperatorUsageSummary {
  /** Month bucket — ISO YYYY-MM-01 of the reporting month. */
  month: string;
  totals: OperatorUsageTotals;
}

/**
 * Load the current-month Workspace Operator usage aggregated across every
 * user of the caller's workspace. Intended for the Billing section of
 * Settings — renders the metered-usage subsection.
 *
 * Quota denominators (runLimit, etc.) are *not* returned here; that's
 * Agent B's tier-enforcement work. The UI can combine this summary with
 * the tier-limit API to render "X / Y".
 */
export async function loadOperatorUsageAction(): Promise<
  ActionResult<OperatorUsageSummary>
> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const rows = await getWorkspaceUsageForMonth(supabase, ctx.workspace.id);
    const totals = sumOperatorUsage(rows);

    // Derive the month key from a fresh Date so the UI can label the
    // section "Usage for <month>" without having to call the same helper.
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const month = `${y}-${m}-01`;

    return { ok: true, data: { month, totals } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load Workspace Operator usage.",
    };
  }
}
