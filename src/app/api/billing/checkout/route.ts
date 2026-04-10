import { getRequestContext } from "@/server/auth/get_request_context";

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

  const creemRes = await fetch("https://api.creem.io/v1/checkouts", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      product_id: productId,
      customer_email: user.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        workspace_id: workspace.id,
      },
    }),
  });

  if (!creemRes.ok) {
    const text = await creemRes.text();
    console.error("Creem checkout error:", creemRes.status, text);
    return Response.json(
      { error: "Failed to create checkout session" },
      { status: 502 }
    );
  }

  const session = (await creemRes.json()) as { checkout_url?: string };
  const checkoutUrl = session?.checkout_url;

  if (!checkoutUrl) {
    console.error("Creem checkout response missing checkout_url:", session);
    return Response.json({ error: "Invalid checkout response" }, { status: 502 });
  }

  return Response.json({ checkoutUrl });
}
