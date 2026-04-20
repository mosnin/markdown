import { type SupabaseClient } from "@supabase/supabase-js";

import {
  getWorkspacePlan,
  type WorkspacePlan,
} from "@/server/services/subscription_service";
import {
  getUserUsageForMonth,
  getWorkspaceUsageForMonth,
  sumOperatorUsage,
} from "@/server/services/workspace_operator_usage_service";

/**
 * Workspace Operator quota — the per-tier monthly guardrail on Operator
 * runs. Shipped in Phase 4 alongside the Business tier.
 *
 * Design:
 *   * **Free** tier is a per-WORKSPACE bucket (5 runs/month) so a free
 *     workspace can't sidestep the cap by adding members.
 *   * **Pro** and **Business** tiers are per-USER (50 / 500 runs/month
 *     respectively). A user on multiple Pro workspaces shares one bucket
 *     across them.
 *   * `override_operator_quota = true` on the workspace_subscriptions row
 *     bypasses the check entirely. That flag is an admin escape hatch
 *     (see migration `20260419000004_business_tier.sql`); it's distinct
 *     from `manually_overridden`, which only gates Creem webhook sync.
 *   * The service fails *open*. Any unexpected error — missing usage
 *     table, network blip, Agent-A module not yet deployed — returns
 *     `allowed: true`. Quota is a guardrail, not a paywall; we'd rather
 *     let a user run a job than 500 than block a legitimate request on a
 *     flaky dependency.
 *
 * Month boundary: `resetsAt` is always the first second of the next
 * calendar month in UTC.
 */

// ─── Public surface ──────────────────────────────────────────────────────────

export interface OperatorQuota {
  tier: WorkspacePlan;
  limit: number | null;
  used: number;
  remaining: number;
  allowed: boolean;
  /** First day (00:00:00 UTC) of next month. */
  resetsAt: Date;
}

/**
 * Per-tier monthly run caps. Free is per-workspace; Pro/Business are per-user.
 */
export const OPERATOR_TIER_LIMITS: Record<WorkspacePlan, number> = {
  free: 5,
  pro: 50,
  business: 500,
};

// Sentinel for the "remaining" field when quota is waived. JSON-compatible.
const UNLIMITED_REMAINING = 999_999;

export interface CheckOperatorQuotaArgs {
  userId: string;
  workspaceId: string;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function checkOperatorQuota(
  supabase: SupabaseClient,
  args: CheckOperatorQuotaArgs
): Promise<OperatorQuota> {
  const { userId, workspaceId } = args;

  const tier = await getWorkspacePlan(supabase, workspaceId).catch(() => "free" as WorkspacePlan);
  const resetsAt = firstOfNextMonthUTC();

  // Admin override flag — short-circuit everything else.
  const override = await loadQuotaOverride(supabase, workspaceId);
  if (override) {
    return {
      tier,
      limit: null,
      used: 0,
      remaining: UNLIMITED_REMAINING,
      allowed: true,
      resetsAt,
    };
  }

  const limit = OPERATOR_TIER_LIMITS[tier];

  // Sum this month's usage with the tier-appropriate grain.
  let used = 0;
  try {
    if (tier === "free") {
      const rows = await getWorkspaceUsageForMonth(supabase, workspaceId);
      used = sumOperatorUsage(rows).runCount;
    } else {
      const rows = await getUserUsageForMonth(supabase, userId);
      used = sumOperatorUsage(rows).runCount;
    }
  } catch (err) {
    // Fail open — quota is a guardrail, not a paywall.
    console.warn(
      "[workspace_operator_quota] usage lookup failed; allowing run",
      err
    );
    return {
      tier,
      limit,
      used: 0,
      remaining: limit,
      allowed: true,
      resetsAt,
    };
  }

  const remaining = Math.max(0, limit - used);
  return {
    tier,
    limit,
    used,
    remaining,
    allowed: used < limit,
    resetsAt,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function loadQuotaOverride(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("workspace_subscriptions")
      .select("override_operator_quota")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error || !data) return false;
    return Boolean((data as { override_operator_quota?: boolean }).override_operator_quota);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "PGRST116" || code === "42P01" || code === "42703") {
      // Table or column missing — migration hasn't landed. Treat as "no override".
      return false;
    }
    console.warn(
      "[workspace_operator_quota] override lookup failed",
      err
    );
    return false;
  }
}

/**
 * First second of the following calendar month in UTC. Exposed for the
 * UI: `Resets on MMM D` messaging.
 */
export function firstOfNextMonthUTC(now: Date = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  // Date.UTC rolls year-over when month === 11 (December → next January).
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
}
