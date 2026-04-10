import { Webhook } from "@creem_io/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook
 *
 * Receives and processes Creem webhook events using the @creem_io/nextjs
 * adapter, which handles HMAC-SHA256 signature verification via the
 * `creem-signature` header before invoking any callbacks.
 *
 * Handled events:
 *   checkout.completed    → plan='pro', status='active' (via onCheckoutCompleted)
 *   subscription.active   → plan='pro', status='active'
 *   subscription.paid     → plan='pro', status='active'  (renewal)
 *   subscription.canceled → plan='free', status='cancelled'
 *   subscription.expired  → plan='free', status='cancelled'
 *   subscription.past_due → status='past_due'
 */
export const POST = Webhook({
  webhookSecret: process.env.CREEM_WEBHOOK_SECRET!,

  // ── checkout.completed ─────────────────────────────────────────────────────
  onCheckoutCompleted: async ({ id, customer, subscription, metadata }) => {
    const workspaceId = (metadata?.workspace_id as string | undefined) ?? null;

    if (!workspaceId) {
      console.warn(
        `Creem webhook [checkout.completed]: no workspace_id in metadata`,
        { checkoutId: id }
      );
      return;
    }

    const adminClient = createAdminClient();

    const upsert: Record<string, unknown> = {
      workspace_id: workspaceId,
      plan: "pro",
      status: "active",
    };

    if (subscription && typeof subscription === "object" && "id" in subscription) {
      upsert.creem_subscription_id = subscription.id;
    }

    if (customer && typeof customer === "object" && "id" in customer) {
      upsert.creem_customer_id = customer.id;
    }

    const { error } = await adminClient
      .from("workspace_subscriptions")
      .upsert(upsert, { onConflict: "workspace_id" });

    if (error) {
      console.error(
        "Creem webhook [checkout.completed]: failed to upsert workspace_subscriptions",
        error
      );
      throw error; // causes the handler to return 500 so Creem retries
    }
  },

  // ── subscription.active ────────────────────────────────────────────────────
  onSubscriptionActive: async ({
    id,
    customer,
    current_period_end_date,
    metadata,
  }) => {
    await upsertSubscription({
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      periodEnd:
        current_period_end_date instanceof Date
          ? current_period_end_date.toISOString()
          : undefined,
      plan: "pro",
      status: "active",
      metadata,
    });
  },

  // ── subscription.paid ──────────────────────────────────────────────────────
  onSubscriptionPaid: async ({
    id,
    customer,
    current_period_end_date,
    metadata,
  }) => {
    await upsertSubscription({
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      periodEnd:
        current_period_end_date instanceof Date
          ? current_period_end_date.toISOString()
          : undefined,
      plan: "pro",
      status: "active",
      metadata,
    });
  },

  // ── subscription.canceled ──────────────────────────────────────────────────
  onSubscriptionCanceled: async ({ id, customer, metadata }) => {
    await upsertSubscription({
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      plan: "free",
      status: "cancelled",
      metadata,
    });
  },

  // ── subscription.expired ───────────────────────────────────────────────────
  onSubscriptionExpired: async ({ id, customer, metadata }) => {
    await upsertSubscription({
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      plan: "free",
      status: "cancelled",
      metadata,
    });
  },

  // ── subscription.past_due ──────────────────────────────────────────────────
  onSubscriptionPastDue: async ({ id, customer, metadata }) => {
    await upsertSubscription({
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      status: "past_due",
      metadata,
    });
  },
});

// ── Shared upsert helper ─────────────────────────────────────────────────────

interface UpsertSubscriptionOptions {
  subscriptionId: string;
  customerId?: string;
  periodEnd?: string;
  plan?: "free" | "pro";
  status?: "active" | "cancelled" | "past_due";
  metadata?: Record<string, string | number | null>;
}

async function upsertSubscription({
  subscriptionId,
  customerId,
  periodEnd,
  plan,
  status,
  metadata,
}: UpsertSubscriptionOptions): Promise<void> {
  const workspaceId = (metadata?.workspace_id as string | undefined) ?? null;

  if (!workspaceId) {
    console.warn(
      `Creem webhook: no workspace_id in metadata for subscription ${subscriptionId}`
    );
    return;
  }

  const adminClient = createAdminClient();

  const row: Record<string, unknown> = { workspace_id: workspaceId };

  if (subscriptionId) row.creem_subscription_id = subscriptionId;
  if (customerId) row.creem_customer_id = customerId;
  if (plan !== undefined) row.plan = plan;
  if (status !== undefined) row.status = status;
  if (periodEnd !== undefined) row.current_period_end = periodEnd;

  const { error } = await adminClient
    .from("workspace_subscriptions")
    .upsert(row, { onConflict: "workspace_id" });

  if (error) {
    console.error(
      "Creem webhook: failed to upsert workspace_subscriptions",
      error
    );
    throw error; // causes the handler to return 500 so Creem retries
  }
}
