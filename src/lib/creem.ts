/**
 * Creem.io billing client wrapper.
 *
 * Uses the `creem_io` SDK via `createCreem()`. Only exposes what the app needs:
 *   - createCheckout()      — start a hosted checkout session
 *   - createPortalSession() — generate a customer portal link
 *   - verifyWebhookSignature() — verify HMAC-SHA256 webhook signature
 *
 * All functions are server-only. Never import this in client components.
 */

import * as crypto from "crypto";
import { createCreem } from "creem_io";

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

function getCreemClient() {
  const apiKey = process.env.CREEM_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("[creem] CREEM_API_KEY environment variable is not set");
  }
  return createCreem({
    apiKey,
    testMode: process.env.NODE_ENV !== "production",
  });
}

type CreemClient = ReturnType<typeof createCreem>;

// Lazy singleton — instantiated once per server process.
let _client: CreemClient | null = null;
function client(): CreemClient {
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
  /** URL to redirect to if the customer cancels. */
  cancelUrl?: string;
  /** Pre-fill customer email if known. */
  customerEmail?: string;
  /** Arbitrary metadata forwarded to webhook events. */
  metadata?: Record<string, string | number | null>;
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

  const checkout = await client().checkouts.create({
    productId,
    successUrl,
    ...(customerEmail ? { customer: { email: customerEmail } } : {}),
    ...(metadata ? { metadata } : {}),
  });

  // The SDK returns `checkoutUrl` (camelCase) on the Checkout object.
  const checkoutUrl = checkout.checkoutUrl;

  if (!checkoutUrl) {
    throw new Error("[creem] Checkout session returned no checkoutUrl");
  }

  return {
    id: checkout.id,
    checkoutUrl,
  };
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
  const result = await client().customers.createPortal({ customerId });

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
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}
