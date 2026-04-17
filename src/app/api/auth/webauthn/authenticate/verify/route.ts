import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyAuthenticationAndGetUser } from "@/server/services/webauthn_service";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/webauthn/authenticate/verify
 *
 * Verifies a WebAuthn authentication response and creates a Supabase
 * session for the user who owns the passkey. Does NOT require an
 * existing session — this is the passwordless sign-in endpoint.
 *
 * Body: { response: AuthenticationResponseJSON }
 *
 * On success, sets session cookies and returns { verified: true }.
 */
export async function POST(request: Request) {
  let body: { response: unknown };
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
    // Use admin client for credential lookup (RLS may block anonymous reads).
    const adminSupabase = createAdminClient();
    const { userId } = await verifyAuthenticationAndGetUser(
      adminSupabase,
      body.response as AuthenticationResponseJSON,
    );

    // Look up the user's email so we can generate a magic link.
    const { data: userData, error: userErr } =
      await adminSupabase.auth.admin.getUserById(userId);

    if (userErr || !userData?.user?.email) {
      console.error("[webauthn/authenticate/verify] user lookup failed", userErr);
      return Response.json(
        { error: "Failed to create session" },
        { status: 500 },
      );
    }

    // Generate a magic link and extract the hashed token.
    const { data: linkData, error: linkErr } =
      await adminSupabase.auth.admin.generateLink({
        type: "magiclink",
        email: userData.user.email,
      });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error("[webauthn/authenticate/verify] link generation failed", linkErr);
      return Response.json(
        { error: "Failed to create session" },
        { status: 500 },
      );
    }

    // Use the regular (cookie-writing) Supabase client to verify the OTP,
    // which creates a session and sets auth cookies automatically.
    const supabase = await createClient();
    const { error: otpErr } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    });

    if (otpErr) {
      console.error("[webauthn/authenticate/verify] OTP verification failed", otpErr);
      return Response.json(
        { error: "Failed to create session" },
        { status: 500 },
      );
    }

    return Response.json({ verified: true });
  } catch (err) {
    console.error("[webauthn/authenticate/verify]", err);
    const message =
      err instanceof Error ? err.message : "Authentication verification failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
