import { type WorkspacePlan } from "@/server/services/subscription_service";

/**
 * Per-tier paywall limits for the write-PROPOSAL loop — the core metered
 * action of Poggle (agents submit write proposals; humans approve them).
 *
 * These mirror the shape of `OPERATOR_TIER_LIMITS`
 * (workspace_operator_quota_service.ts): free/trial small, Pro larger,
 * Business largest. They are deliberately a separate module so the numbers
 * can be tuned without touching the enforcement service.
 *
 * Semantics:
 *   - `PROPOSAL_TIER_LIMITS` is a *per-workspace*, *per-billing-period* cap
 *     on the number of write proposals created. Free is a hard paywall;
 *     Pro/Business are generous but bounded so the plan still "bites".
 *   - `CONNECTED_AGENT_TIER_LIMITS` caps how many live connections (MCP /
 *     OAuth clients = "connected agents") a workspace may have at once.
 *     Cheap to enforce (a single count) and a natural per-tier lever.
 *
 * The billing period is the subscription's calendar month (reset on the
 * first second of the next month, UTC) — see `firstOfNextPeriodUTC` in the
 * quota service. Free workspaces have no Creem period, so the same UTC
 * month boundary is used for everyone, which keeps the maths trivial and
 * matches the existing operator-quota behaviour.
 */

/**
 * Maximum write proposals a workspace may create per billing period, by tier.
 *
 * `free` doubles as the trial / no-subscription default (see
 * `getWorkspacePlan`, which collapses cancelled/absent subscriptions to
 * `free`).
 */
export const PROPOSAL_TIER_LIMITS: Record<WorkspacePlan, number> = {
  free: 20,
  pro: 1_000,
  business: 10_000,
};

/**
 * Maximum simultaneously-active connected agents (MCP / OAuth clients) a
 * workspace may have, by tier. Enforced as a live count, not per period.
 */
export const CONNECTED_AGENT_TIER_LIMITS: Record<WorkspacePlan, number> = {
  free: 1,
  pro: 10,
  business: 100,
};

/** Where the over-limit result points the user to upgrade. */
export const UPGRADE_URL = "/pricing";
