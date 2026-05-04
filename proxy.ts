import { type NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";
import { observeRouteLatency } from "@/lib/perf/instrumentation";

// ─── Nonce-based Content Security Policy ─────────────────────────────────────
//
// Next.js 16 reads the nonce from the Content-Security-Policy REQUEST header
// (set below via requestHeaders) and automatically injects it into all
// framework-generated script tags, enabling strict nonce-based CSP on every
// dynamically-rendered page.
//
// Pages MUST be dynamically rendered for nonces to work — static pages are
// built at build time when no request exists, so no nonce can be injected.
// Marketing pages guarantee this via `await connection()` in their component.
//
// Directive rationale:
//
// script-src 'nonce-...' 'strict-dynamic'
//   The nonce authorises Next.js-injected inline scripts; 'strict-dynamic'
//   propagates trust to dynamically loaded sub-resources (code-split chunks).
//   'unsafe-eval' is added in development because React uses eval for enhanced
//   server-error debugging.
//
// style-src 'unsafe-inline'
//   Tailwind CSS v4 and next-themes inject inline styles at runtime.
//
// img-src data: https:
//   Markdown content may embed data: URIs; external images are https only.
//
// connect-src https://*.supabase.co wss://*.supabase.co
//   Supabase REST, Realtime WebSocket, Storage, and auth.
//
// frame-src / object-src 'none'
//   No iframes or plugin content used anywhere in the app.

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
 * Renamed from middleware.ts (middleware is deprecated in Next.js 16).
 * Runs on every non-static request. For each request it:
 * 1. Generates a cryptographically random nonce for Content Security Policy.
 * 2. Sets the nonce as the `x-nonce` request header so Next.js can extract it.
 * 3. Sets the CSP in the request headers so Next.js applies the nonce to scripts.
 * 4. Delegates to `refreshSession` for Supabase auth cookie refresh.
 * 5. Sets the CSP response header so browsers enforce the policy.
 *
 * Authorization is NOT enforced here — it lives in server components via
 * `requireAuthenticatedUser()`.
 */
export default async function proxy(
  request: NextRequest,
): Promise<NextResponse> {
  // Stamp the start so we can record route-class latency at the bottom of
  // this function. We measure the whole proxy duration (which includes
  // the Supabase session refresh) rather than just request-bytes-in to
  // request-bytes-out — this is the closest proxy of TTFB available
  // without an end-to-end span. See `src/lib/perf/instrumentation.ts`.
  const perfStart = Date.now();

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

  // Record route-class latency. PII-free — we pass only the pathname,
  // and `observeRouteLatency` strips it down to a route-class label
  // before anything is buffered. Fire-and-forget; never block the
  // response on telemetry.
  try {
    observeRouteLatency(request.nextUrl.pathname, Date.now() - perfStart);
  } catch {
    // Telemetry must never fail a request.
  }

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
