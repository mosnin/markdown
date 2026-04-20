/**
 * Domain type: WorkspaceSubscription
 *
 * Mirrors the public.workspace_subscriptions table shape.
 */

/**
 * The set of billing tiers a workspace can be on. Kept in sync with
 * the CHECK constraint on workspace_subscriptions.plan (see
 * 20260419000004_business_tier.sql).
 */
export const WORKSPACE_PLANS = ["free", "pro", "business"] as const;

export type SubscriptionPlan = (typeof WORKSPACE_PLANS)[number];
export type SubscriptionStatus = "active" | "cancelled" | "past_due";

export interface WorkspaceSubscription {
  id: string;
  workspace_id: string;
  creem_customer_id: string | null;
  creem_subscription_id: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_end: string | null;
  manually_overridden: boolean;
  /**
   * Admin escape hatch that disables per-tier Operator quota enforcement
   * for this workspace. Independent of manually_overridden (which only
   * gates Creem sync). See migration 20260419000004_business_tier.sql.
   */
  override_operator_quota: boolean;
  created_at: string;
  updated_at: string;
}

/** Input for upserting a workspace subscription record. */
export interface UpsertSubscriptionInput {
  workspace_id: string;
  creem_customer_id?: string | null;
  creem_subscription_id?: string | null;
  plan?: SubscriptionPlan;
  status?: SubscriptionStatus;
  current_period_end?: string | null;
  manually_overridden?: boolean;
  override_operator_quota?: boolean;
}
