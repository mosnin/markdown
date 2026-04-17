import { getRequestContext } from "@/server/auth/get_request_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateRegistrationOpts } from "@/server/services/webauthn_service";

export const runtime = "nodejs";

/**
 * POST /api/auth/webauthn/register/options
 *
 * Returns WebAuthn registration challenge options for the currently
 * authenticated user. The response is passed to
 * `@simplewebauthn/browser`'s `startRegistration()`.
 */
export async function POST() {
  const ctx = await getRequestContext();

  if (!ctx.isAuthenticated || !ctx.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const options = await generateRegistrationOpts(
      supabase,
      ctx.user.id,
      ctx.user.email ?? "",
    );
    return Response.json(options);
  } catch (err) {
    console.error("[webauthn/register/options]", err);
    return Response.json(
      { error: "Failed to generate registration options" },
      { status: 500 },
    );
  }
}
