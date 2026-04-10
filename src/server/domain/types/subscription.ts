/**
 * Domain type: WorkspaceSubscription
 *
 * Mirrors the public.workspace_subscriptions table shape.
 */

export type SubscriptionPlan = "free" | "pro";
export type SubscriptionStatus = "active" | "cancelled" | "past_due";

export interface WorkspaceSubscription {
  id: string;
  workspace_id: string;
  creem_customer_id: string | null;
  creem_subscription_id: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_end: string | null;
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
}
