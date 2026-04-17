import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Session proxy — refreshes the Supabase auth session on every request.
 *
 * Called from `proxy.ts` on all non-static requests. It:
 * 1. Creates a Supabase client wired to the incoming request cookies.
 * 2. Calls `getUser()` which transparently refreshes expired tokens.
 * 3. Propagates any updated cookies to both the request and response.
 *
 * When `requestHeaders` is provided, those headers are forwarded to
 * downstream server components via `NextResponse.next()`. This is used
 * by the proxy to thread the CSP nonce through to the rendering layer.
 *
 * This function does NOT enforce authorization. Route protection lives
 * in server components via `requireAuthenticatedUser()`.
 */
export async function refreshSession(
  request: NextRequest,
  requestHeaders?: Headers
): Promise<NextResponse> {
  // Start with a pass-through response; may be replaced if cookies change.
  // When extra headers are provided (e.g. CSP nonce), forward them so
  // Next.js can read them during rendering.
  let response = NextResponse.next({
    request: {
      headers: requestHeaders ?? request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Forward updated cookies onto the outgoing request…
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // …and rebuild the response so they're sent back to the browser.
          response = NextResponse.next({
            request: {
              headers: requestHeaders ?? request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: use getUser(), not getSession(). getSession() reads only
  // from the cookie without verifying with the Supabase server. getUser()
  // validates the JWT and refreshes it when expired.
  await supabase.auth.getUser();

  return response;
}
