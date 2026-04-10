import { getRequestContext } from "@/server/auth/get_request_context";
import { createCreem } from "creem_io";

export const runtime = "nodejs";

/**
 * POST /api/billing/checkout
 *
 * Creates a Creem checkout session for the Pro plan and returns the checkout
 * URL. The caller should redirect the user to that URL.
 *
 * Response:
 *   { checkoutUrl: string }
 */
export async function POST() {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { user, workspace } = ctx;

  // ── Env vars ────────────────────────────────────────────────────────────────
  const apiKey = process.env.CREEM_API_KEY;
  const productId = process.env.CREEM_PRO_PRODUCT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!apiKey || !productId) {
    console.error("Missing CREEM_API_KEY or CREEM_PRO_PRODUCT_ID env vars");
    return Response.json({ error: "Billing not configured" }, { status: 500 });
  }

  // ── Create Creem checkout session ───────────────────────────────────────────
  const successUrl = `${appUrl}/app/settings?billing=success`;
  const cancelUrl = `${appUrl}/app/settings?billing=cancelled`;

  const creem = createCreem({
    apiKey,
    testMode: process.env.NODE_ENV !== "production",
  });

  let checkout;
  try {
    checkout = await creem.checkouts.create({
      productId,
      successUrl,
      ...(user.email ? { customer: { email: user.email } } : {}),
      metadata: {
        workspace_id: workspace.id,
      },
    });
  } catch (err) {
    console.error("Creem checkout error:", err);
    return Response.json(
      { error: "Failed to create checkout session" },
      { status: 502 }
    );
  }

  // SDK returns checkoutUrl (camelCase). The confirmed spec refers to
  // checkout.checkout_url — both are the same field from the API response.
  const checkoutUrl = checkout.checkoutUrl;

  if (!checkoutUrl) {
    console.error("Creem checkout response missing checkoutUrl:", checkout);
    return Response.json({ error: "Invalid checkout response" }, { status: 502 });
  }

  void cancelUrl; // retained for future cancel_url support in the SDK

  return Response.json({ checkoutUrl });
}
