import { type NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";

// ─── Nonce-based Content Security Policy ─────────────────────────────────────
//
// Next.js 16 automatically extracts the nonce from the CSP header and applies
// it to all framework scripts, page bundles, and inline scripts/styles it
// generates. The proxy generates a fresh nonce per request and threads it
// through via the `x-nonce` request header and the `Content-Security-Policy`
// response header.
//
// Directive rationale (unchanged items carry over from the original static CSP):
//
// script-src 'nonce-...' 'strict-dynamic'
//   Replaces 'unsafe-inline'. The nonce authorises Next.js-injected inline
//   scripts; 'strict-dynamic' lets those scripts load further sub-resources
//   (e.g. code-split chunks). In development 'unsafe-eval' is added because
//   React uses eval for enhanced server-error debugging.
//
// style-src 'unsafe-inline'
//   Tailwind CSS v4 and next-themes inject inline styles. Required for correct
//   rendering of the design token system and theme switching.
//
// img-src data: https:
//   Markdown content may include data: URI inline images and external https
//   images.
//
// connect-src https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io
//   Supabase SSR auth, data queries, Storage signed URL downloads, Realtime
//   WebSocket connections, and Sentry error ingestion.
//
// font-src 'self'
//   Geist is bundled via the geist npm package.
//
// frame-src 'none'
//   No iframes rendered.
//
// object-src 'none'
//   No plugin content used.
//
// base-uri 'self'
//   Prevent <base> tag injection attacks.
//
// form-action 'self'
//   All form submissions go to the same origin.

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return directives.join("; ");
}

/**
 * Next.js 16 proxy — nonce-based CSP + Supabase session refresh.
 *
 * Runs on every non-static request. For each request it:
 * 1. Generates a cryptographically random nonce for Content Security Policy.
 * 2. Sets the nonce as the `x-nonce` request header so Next.js can extract it.
 * 3. Delegates to `refreshSession` for Supabase auth cookie refresh.
 * 4. Sets the CSP response header with the nonce.
 *
 * Authorization is NOT enforced here — it lives in server components via
 * `requireAuthenticatedUser()`.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Thread the nonce + CSP into the request headers so Next.js can
  // extract the nonce and apply it to all framework-injected scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // Refresh Supabase auth cookies, forwarding the augmented headers.
  const response = await refreshSession(request, requestHeaders);

  // Set CSP on the outgoing response so browsers enforce the policy.
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except:
     * - _next/static  (Next.js static assets)
     * - _next/image   (image optimisation)
     * - favicon.ico
     * - common static asset extensions
     *
     * Also skip prefetch requests — they don't need the CSP header.
     */
    {
      source:
        "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
