/**
 * Creem.io billing client wrapper.
 *
 * Thin layer around the `creem` SDK. Only exposes what the app needs:
 *   - createCheckout()      — start a hosted checkout session
 *   - getSubscription()     — retrieve a subscription by Creem subscription ID
 *   - createPortalSession() — generate a customer portal link
 *
 * All functions are server-only. Never import this in client components.
 */

import * as crypto from "crypto";
import { Creem } from "creem";

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

function getCreemClient(): Creem {
  const apiKey = process.env.CREEM_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("[creem] CREEM_API_KEY environment variable is not set");
  }
  return new Creem({ apiKey });
}

// Lazy singleton — instantiated once per server process.
let _client: Creem | null = null;
function client(): Creem {
  if (!_client) _client = getCreemClient();
  return _client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateCheckoutOptions {
  /** Creem product ID for the plan being purchased. */
  productId: string;
  /** URL to redirect to after successful payment. */
  successUrl: string;
  /** Pre-fill customer email if known. */
  customerEmail?: string;
  /** Arbitrary metadata forwarded to webhook events. */
  metadata?: Record<string, unknown>;
}

export interface CheckoutResult {
  /** Creem checkout session ID. */
  id: string;
  /** Hosted checkout URL to redirect the user to. */
  checkoutUrl: string;
}

export interface PortalSessionResult {
  /** Hosted customer portal URL. */
  customerPortalLink: string;
}

// ---------------------------------------------------------------------------
// createCheckout
// ---------------------------------------------------------------------------

/**
 * Creates a Creem hosted checkout session.
 *
 * Redirect the user to `checkoutUrl` to complete payment.
 */
export async function createCheckout(
  options: CreateCheckoutOptions
): Promise<CheckoutResult> {
  const { productId, successUrl, customerEmail, metadata } = options;

  const result = await client().checkouts.create({
    productId,
    successUrl,
    ...(customerEmail ? { customer: { email: customerEmail } } : {}),
    ...(metadata ? { metadata } : {}),
  });

  if (!result.checkoutUrl) {
    throw new Error("[creem] Checkout session returned no checkoutUrl");
  }

  return {
    id: result.id,
    checkoutUrl: result.checkoutUrl,
  };
}

// ---------------------------------------------------------------------------
// getSubscription
// ---------------------------------------------------------------------------

/**
 * Retrieves a Creem subscription by its subscription ID.
 *
 * Returns the raw SubscriptionEntity from the SDK.
 */
export async function getSubscription(subscriptionId: string) {
  return client().subscriptions.get(subscriptionId);
}

// ---------------------------------------------------------------------------
// createPortalSession
// ---------------------------------------------------------------------------

/**
 * Generates a Creem customer portal link.
 *
 * The portal lets customers manage their subscription, update payment methods,
 * and view billing history.
 */
export async function createPortalSession(
  customerId: string
): Promise<PortalSessionResult> {
  const result = await client().customers.generateBillingLinks({
    customerId,
  });

  return { customerPortalLink: result.customerPortalLink };
}

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------

/**
 * Verifies the HMAC-SHA256 signature on a Creem webhook request.
 *
 * @param payload   Raw request body string (do NOT parse before verifying).
 * @param signature Value of the `creem-signature` header.
 * @returns `true` if the signature is valid.
 * @throws  Error if CREEM_WEBHOOK_SECRET is not set.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string
): boolean {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    throw new Error(
      "[creem] CREEM_WEBHOOK_SECRET environment variable is not set"
    );
  }

  const computed = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks.
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(signature, "hex")
  );
}
