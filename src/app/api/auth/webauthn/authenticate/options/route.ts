import { createAdminClient } from "@/lib/supabase/admin";
import { generateAuthenticationOpts } from "@/server/services/webauthn_service";

export const runtime = "nodejs";

/**
 * POST /api/auth/webauthn/authenticate/options
 *
 * Returns WebAuthn authentication challenge options. Does NOT require an
 * authenticated session (this is the entry point for "Sign in with passkey").
 * Uses a discoverable-credential flow so the browser prompts the user to
 * select a passkey.
 */
export async function POST() {
  try {
    const supabase = createAdminClient();
    const options = await generateAuthenticationOpts(supabase);
    return Response.json(options);
  } catch (err) {
    console.error("[webauthn/authenticate/options]", err);
    return Response.json(
      { error: "Failed to generate authentication options" },
      { status: 500 },
    );
  }
}
