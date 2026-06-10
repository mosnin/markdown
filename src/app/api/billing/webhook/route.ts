import { Webhook } from "@creem_io/nextjs";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { planFromProductId } from "@/server/services/subscription_service";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook
 *
 * Receives and processes Creem webhook events using the @creem_io/nextjs
 * adapter, which handles HMAC-SHA256 signature verification via the
 * `creem-signature` header before invoking any callbacks.
 *
 * Handled events:
 *   checkout.completed    → plan from product id, status='active' (via onCheckoutCompleted)
 *   subscription.active   → plan='pro', status='active'
 *   subscription.paid     → plan='pro', status='active'  (renewal)
 *   subscription.canceled → plan='free', status='cancelled'
 *   subscription.expired  → plan='free', status='cancelled'
 *   subscription.past_due → status='past_due'
 *
 * Admin override:
 *   Every plan/status write first checks the existing row's
 *   `manually_overridden` flag. When it is true the workspace has been
 *   comped/adjusted by an admin (see admin/subscriptions/actions.ts) and
 *   the flag's contract is that it gates Creem sync — so we SKIP the
 *   plan/status write rather than let a later Creem event clobber the
 *   override. See `isManuallyOverridden`.
 *
 * Idempotency / replay protection:
 *   Creem retries failed deliveries and may redeliver old events, so a stale
 *   event (e.g. an old `subscription.canceled` redelivered after a renewal)
 *   could clobber current plan/status. Every flat callback payload carries a
 *   unique `webhookId`; at the start of each handler we record it in
 *   `processed_webhook_events` (PRIMARY KEY) via the admin client. If the id
 *   was already recorded the event is a replay and the handler no-ops. See
 *   `markWebhookProcessed`.
 */
function getWebhookHandler() {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    return async () => new Response("Webhook secret not configured", { status: 500 });
  }
  return Webhook({
    webhookSecret: secret,

  // ── checkout.completed ─────────────────────────────────────────────────────
  onCheckoutCompleted: async ({ id, webhookId, webhookEventType, product, customer, subscription, metadata }) => {
    const adminClient = createAdminClient();

    // Replay guard: a redelivered, signature-valid event must not be processed
    // twice. Skip if we have already recorded this webhook id.
    if (!(await markWebhookProcessed(adminClient, webhookId, webhookEventType))) {
      return;
    }

    const workspaceId = typeof metadata?.workspace_id === 'string' ? metadata.workspace_id : null;

    if (!workspaceId) {
      console.warn(
        `Creem webhook [checkout.completed]: no workspace_id in metadata`,
        { checkoutId: id }
      );
      return;
    }

    // Admin-comped workspaces are pinned by `manually_overridden`; a later
    // Creem checkout must not silently downgrade/clobber them.
    if (await isManuallyOverridden(adminClient, workspaceId)) {
      console.info(
        "Creem webhook [checkout.completed]: workspace is manually_overridden; skipping plan/status write",
        { workspaceId, checkoutId: id }
      );
      return;
    }

    // Derive the tier from the purchased product so Business buyers aren't
    // under-provisioned as Pro. `product` is the expanded ProductEntity.
    const plan = planFromProductId(
      product && typeof product === "object" && "id" in product
        ? product.id
        : null
    );

    const upsert: Record<string, unknown> = {
      workspace_id: workspaceId,
      plan,
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
    webhookId,
    webhookEventType,
    customer,
    current_period_end_date,
    metadata,
  }) => {
    await upsertSubscription({
      webhookId,
      webhookEventType,
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      periodEnd:
        current_period_end_date
          ? String(current_period_end_date)
          : undefined,
      plan: "pro",
      status: "active",
      metadata,
    });
  },

  // ── subscription.paid ──────────────────────────────────────────────────────
  onSubscriptionPaid: async ({
    id,
    webhookId,
    webhookEventType,
    customer,
    current_period_end_date,
    metadata,
  }) => {
    await upsertSubscription({
      webhookId,
      webhookEventType,
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      periodEnd:
        current_period_end_date
          ? String(current_period_end_date)
          : undefined,
      plan: "pro",
      status: "active",
      metadata,
    });
  },

  // ── subscription.canceled ──────────────────────────────────────────────────
  onSubscriptionCanceled: async ({ id, webhookId, webhookEventType, customer, metadata }) => {
    await upsertSubscription({
      webhookId,
      webhookEventType,
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      plan: "free",
      status: "cancelled",
      metadata,
    });
  },

  // ── subscription.expired ───────────────────────────────────────────────────
  onSubscriptionExpired: async ({ id, webhookId, webhookEventType, customer, metadata }) => {
    await upsertSubscription({
      webhookId,
      webhookEventType,
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      plan: "free",
      status: "cancelled",
      metadata,
    });
  },

  // ── subscription.past_due ──────────────────────────────────────────────────
  onSubscriptionPastDue: async ({ id, webhookId, webhookEventType, customer, metadata }) => {
    await upsertSubscription({
      webhookId,
      webhookEventType,
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      status: "past_due",
      metadata,
    });
  },

  // ── subscription.paused ────────────────────────────────────────────────────
  // Creem's contract for a paused subscription is to revoke access. Drop the
  // workspace off paid provisioning (status != 'active') until it resumes;
  // leave the plan so the row stays linked for the eventual resume.
  onSubscriptionPaused: async ({ id, webhookId, webhookEventType, customer, metadata }) => {
    await upsertSubscription({
      webhookId,
      webhookEventType,
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      status: "past_due",
      metadata,
    });
  },

  // ── subscription.unpaid ────────────────────────────────────────────────────
  // Dunning exhausted (payment never recovered) — treat as cancelled so the
  // workspace loses paid access, mirroring subscription.canceled/expired.
  onSubscriptionUnpaid: async ({ id, webhookId, webhookEventType, customer, metadata }) => {
    await upsertSubscription({
      webhookId,
      webhookEventType,
      subscriptionId: id,
      customerId: typeof customer === "object" ? customer.id : undefined,
      plan: "free",
      status: "cancelled",
      metadata,
    });
  },
  });
}

export const POST = getWebhookHandler();

// ── Shared upsert helper ─────────────────────────────────────────────────────

interface UpsertSubscriptionOptions {
  webhookId: string;
  webhookEventType: string;
  subscriptionId: string;
  customerId?: string;
  periodEnd?: string;
  plan?: "free" | "pro" | "business";
  status?: "active" | "cancelled" | "past_due";
  metadata?: Record<string, string | number | null>;
}

async function upsertSubscription({
  webhookId,
  webhookEventType,
  subscriptionId,
  customerId,
  periodEnd,
  plan,
  status,
  metadata,
}: UpsertSubscriptionOptions): Promise<void> {
  const adminClient = createAdminClient();

  // Replay guard: a redelivered, signature-valid event must not be processed
  // twice (e.g. a stale `subscription.canceled` redelivered after a renewal
  // would otherwise downgrade the workspace). Skip if already recorded.
  if (!(await markWebhookProcessed(adminClient, webhookId, webhookEventType))) {
    return;
  }

  const workspaceId = typeof metadata?.workspace_id === 'string' ? metadata.workspace_id : null;

  if (!workspaceId) {
    console.warn(
      `Creem webhook: no workspace_id in metadata for subscription ${subscriptionId}`
    );
    return;
  }

  const row: Record<string, unknown> = { workspace_id: workspaceId };

  if (subscriptionId) row.creem_subscription_id = subscriptionId;
  if (customerId) row.creem_customer_id = customerId;
  if (plan !== undefined) row.plan = plan;
  if (status !== undefined) row.status = status;
  if (periodEnd !== undefined) row.current_period_end = periodEnd;

  // Honour the admin override: when set, this row's plan/status are pinned
  // by an admin and Creem must not change them. If the override is active we
  // strip the plan/status from this write; remaining Creem-owned bookkeeping
  // (subscription/customer ids, period end) is still recorded so the row
  // stays linked to Creem for portal/cancellation flows.
  if (await isManuallyOverridden(adminClient, workspaceId)) {
    delete row.plan;
    delete row.status;

    // If nothing Creem-owned is left to write, there is no row to upsert.
    if (Object.keys(row).length === 1) {
      console.info(
        `Creem webhook: workspace ${workspaceId} is manually_overridden; skipping plan/status write for subscription ${subscriptionId}`
      );
      return;
    }
  }

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

// ── Idempotency / replay guard ───────────────────────────────────────────────

/**
 * Records a webhook event the first time it is seen, returning whether the
 * caller should proceed.
 *
 * The Creem adapter has already verified the signature, but Creem retries
 * failed deliveries and may redeliver stale events; a replayed
 * `subscription.canceled` arriving after a renewal would otherwise clobber the
 * workspace back to free/cancelled. We dedup on the adapter-supplied unique
 * `webhookId` by inserting it into `processed_webhook_events` (PRIMARY KEY).
 *
 *   - Insert succeeds → first time we've seen this event; returns true (proceed).
 *   - Unique violation (23505) → already processed; returns false (no-op).
 *   - Any other error → re-thrown so the handler returns 500 and Creem retries;
 *     we never silently process (or skip) an event whose dedup state is unknown.
 */
async function markWebhookProcessed(
  adminClient: SupabaseClient,
  webhookId: string,
  eventType: string
): Promise<boolean> {
  const { error } = await adminClient
    .from("processed_webhook_events")
    .insert({ webhook_id: webhookId, event_type: eventType });

  if (!error) return true;

  // Postgres unique-violation: this event id is already recorded, so it is a
  // replay. Swallow it and tell the caller to no-op.
  if (
    (error as { code?: string }).code === "23505" ||
    /duplicate key|unique/i.test(error.message ?? "")
  ) {
    console.info(
      "Creem webhook: duplicate event ignored (replay protection)",
      { webhookId, eventType }
    );
    return false;
  }

  console.error(
    "Creem webhook: failed to record processed event id",
    { webhookId, eventType, error }
  );
  throw error; // causes the handler to return 500 so Creem retries
}

// ── Admin-override guard ─────────────────────────────────────────────────────

/**
 * Reads the existing `workspace_subscriptions.manually_overridden` flag for a
 * workspace. Returns true only when a row exists and the flag is explicitly
 * set. The flag's contract (see admin/subscriptions/actions.ts) is that it
 * gates Creem webhook sync, so callers use this to SKIP plan/status writes for
 * admin-comped workspaces.
 *
 * Fails OPEN (returns false) on a read error: a transient read failure should
 * not block a legitimate Creem plan change. The upsert that follows is the
 * source of truth and Creem retries on a hard failure.
 */
async function isManuallyOverridden(
  adminClient: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  const { data, error } = await adminClient
    .from("workspace_subscriptions")
    .select("manually_overridden")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.warn(
      "Creem webhook: failed to read manually_overridden; proceeding with sync",
      { workspaceId, error }
    );
    return false;
  }

  return data?.manually_overridden === true;
}
