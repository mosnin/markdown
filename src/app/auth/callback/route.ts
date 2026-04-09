import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback handler.
 *
 * Supabase redirects here after a magic link click. This route:
 * 1. Exchanges the PKCE `code` param for a session.
 * 2. Writes the session cookies via the server Supabase client.
 * 3. Redirects to /app (or a `next` override if provided).
 *
 * If the code is missing or exchange fails, the user is sent to
 * /sign_in with an error hint so they can try again.
 *
 * Configure the allowed redirect URL in Supabase:
 *   Authentication → URL Configuration → Redirect URLs
 *   Add: http://localhost:3000/auth/callback (dev)
 *       https://your-domain.com/auth/callback (prod)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Allow a `next` override so future flows can deep-link after auth.
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Redirect to the intended destination within the same origin.
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Code was missing or exchange failed — send back to sign in.
  return NextResponse.redirect(
    new URL("/sign_in?error=auth_callback_failed", origin)
  );
}
