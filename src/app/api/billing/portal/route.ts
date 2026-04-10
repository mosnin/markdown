import { getRequestContext } from "@/server/auth/get_request_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCreem } from "creem_io";

export const runtime = "nodejs";

/**
 * POST /api/billing/portal
 *
 * Creates a Creem customer portal session for the authenticated user's
 * workspace and returns the portal URL.
 *
 * Response:
 *   { portalUrl: string }
 */
export async function POST() {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspace } = ctx;

  // ── Look up Creem customer ID ───────────────────────────────────────────────
  const adminClient = createAdminClient();

  const { data: subscription, error: dbError } = await adminClient
    .from("workspace_subscriptions")
    .select("creem_customer_id")
    .eq("workspace_id", workspace.id)
    .limit(1)
    .maybeSingle();

  if (dbError) {
    console.error("Portal: failed to query workspace_subscriptions", dbError);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const creemCustomerId = subscription?.creem_customer_id;

  if (!creemCustomerId) {
    return Response.json(
      { error: "No active subscription found for this workspace" },
      { status: 404 }
    );
  }

  // ── Env vars ────────────────────────────────────────────────────────────────
  const apiKey = process.env.CREEM_API_KEY;

  if (!apiKey) {
    console.error("Missing CREEM_API_KEY env var");
    return Response.json({ error: "Billing not configured" }, { status: 500 });
  }

  // ── Create Creem customer portal session ────────────────────────────────────
  const creem = createCreem({
    apiKey,
    testMode: process.env.NODE_ENV !== "production",
  });

  let portalResult;
  try {
    // creem.customers.createPortal({ customerId }) returns CustomerLinks
    // with .customerPortalLink — equivalent to creem.customers.billing(customerId).url
    portalResult = await creem.customers.createPortal({
      customerId: creemCustomerId,
    });
  } catch (err) {
    console.error("Creem portal error:", err);
    return Response.json(
      { error: "Failed to create portal session" },
      { status: 502 }
    );
  }

  const portalUrl = portalResult?.customerPortalLink;

  if (!portalUrl) {
    console.error("Creem portal response missing URL field:", portalResult);
    return Response.json({ error: "Invalid portal response" }, { status: 502 });
  }

  return Response.json({ portalUrl });
}
