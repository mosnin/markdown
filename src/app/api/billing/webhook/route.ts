import { createHmac, timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// ── Creem webhook event types ──────────────────────────────────────────────────

type CreemEventType =
  | "subscription.active"
  | "subscription.paid"
  | "subscription.canceled"
  | "subscription.scheduled_cancel"
  | "subscription.past_due"
  | "subscription.expired"
  | "subscription.trialing"
  | "subscription.paused"
  | "subscription.update"
  | "checkout.completed"
  | string;

interface CreemSubscriptionObject {
  id: string;
  status: string;
  current_period_end_date?: string;
  metadata?: Record<string, string>;
  customer?: {
    id: string;
    email?: string;
  };
}

interface CreemWebhookEvent {
  eventType: CreemEventType;
  object: CreemSubscriptionObject;
}

// ── Signature verification ─────────────────────────────────────────────────────

function verifyCreemSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const computed = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/billing/webhook
 *
 * Receives and processes Creem webhook events.
 * Verifies the HMAC-SHA256 signature from the `creem-signature` header before
 * processing any payload.
 *
 * Handled events:
 *   subscription.active   → plan='pro', status='active'
 *   subscription.paid     → plan='pro', status='active'  (renewal)
 *   subscription.canceled → plan='free', status='cancelled'
 *   subscription.expired  → plan='free', status='cancelled'
 *   subscription.past_due → status='past_due'
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.CREEM_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("CREEM_WEBHOOK_SECRET is not set");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get("creem-signature") ?? "";

  if (!verifyCreemSignature(rawBody, signature, webhookSecret)) {
    console.warn("Creem webhook: invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  // Parse after verification
  let event: CreemWebhookEvent;
  try {
    event = JSON.parse(rawBody) as CreemWebhookEvent;
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  const { eventType, object: sub } = event;

  // Extract workspace_id from metadata
  const workspaceId = sub?.metadata?.workspace_id;

  if (!workspaceId) {
    // Some events (e.g. checkout.completed) may not have workspace metadata;
    // log and acknowledge so Creem does not retry indefinitely.
    console.warn(`Creem webhook: no workspace_id in metadata for event ${eventType}`, {
      subscriptionId: sub?.id,
    });
    return new Response("OK", { status: 200 });
  }

  const adminClient = createAdminClient();

  // Build the upsert payload based on the event type
  interface SubscriptionUpsert {
    workspace_id: string;
    creem_subscription_id?: string;
    creem_customer_id?: string;
    plan?: "free" | "pro";
    status?: "active" | "cancelled" | "past_due";
    current_period_end?: string | null;
  }

  const upsert: SubscriptionUpsert = { workspace_id: workspaceId };

  if (sub?.id) {
    upsert.creem_subscription_id = sub.id;
  }
  if (sub?.customer?.id) {
    upsert.creem_customer_id = sub.customer.id;
  }
  if (sub?.current_period_end_date) {
    upsert.current_period_end = sub.current_period_end_date;
  }

  switch (eventType) {
    case "subscription.active":
    case "subscription.paid":
      upsert.plan = "pro";
      upsert.status = "active";
      break;

    case "subscription.canceled":
    case "subscription.scheduled_cancel":
    case "subscription.expired":
      upsert.plan = "free";
      upsert.status = "cancelled";
      break;

    case "subscription.past_due":
      upsert.status = "past_due";
      break;

    default:
      // Acknowledge unhandled events without error so Creem stops retrying
      console.log(`Creem webhook: unhandled event type "${eventType}" — ignoring`);
      return new Response("OK", { status: 200 });
  }

  const { error } = await adminClient
    .from("workspace_subscriptions")
    .upsert(upsert, { onConflict: "workspace_id" });

  if (error) {
    console.error("Creem webhook: failed to upsert workspace_subscriptions", error);
    // Return 500 so Creem retries
    return new Response("Database error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
