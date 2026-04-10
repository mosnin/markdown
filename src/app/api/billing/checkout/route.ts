import { getRequestContext } from "@/server/auth/get_request_context";
import { createCheckout } from "@/lib/creem";

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
  const productId = process.env.CREEM_PRO_PRODUCT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appUrl) {
    console.error("[billing/checkout] NEXT_PUBLIC_APP_URL is not set");
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (!productId) {
    console.error("Missing CREEM_PRO_PRODUCT_ID env var");
    return Response.json({ error: "Billing not configured" }, { status: 500 });
  }

  // ── Create Creem checkout session ───────────────────────────────────────────
  const successUrl = `${appUrl}/app/settings?billing=success`;
  const cancelUrl = `${appUrl}/app/settings?billing=cancelled`;

  let result;
  try {
    result = await createCheckout({
      productId,
      successUrl,
      cancelUrl,
      customerEmail: user.email ?? undefined,
      metadata: { workspace_id: workspace.id },
    });
  } catch (err) {
    console.error("Creem checkout error:", err);
    return Response.json(
      { error: "Failed to create checkout session" },
      { status: 502 }
    );
  }

  return Response.json({ checkoutUrl: result.checkoutUrl });
}
