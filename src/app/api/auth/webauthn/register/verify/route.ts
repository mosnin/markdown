import { getRequestContext } from "@/server/auth/get_request_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAndStoreRegistration } from "@/server/services/webauthn_service";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/webauthn/register/verify
 *
 * Verifies the registration response from the browser and stores the new
 * passkey credential. Requires an authenticated session.
 *
 * Body: { response: RegistrationResponseJSON, deviceName?: string }
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { response: unknown; deviceName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.response) {
    return Response.json(
      { error: "Missing response field" },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const result = await verifyAndStoreRegistration(
      supabase,
      ctx.user.id,
      body.response as RegistrationResponseJSON,
      body.deviceName,
    );
    return Response.json({ verified: true, credentialRowId: result.credentialRowId });
  } catch (err) {
    console.error("[webauthn/register/verify]", err);
    const message =
      err instanceof Error ? err.message : "Registration verification failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
