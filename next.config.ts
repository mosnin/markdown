import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// ─── Content Security Policy ──────────────────────────────────────────────────
//
// Allowance rationale:
//
// script-src 'unsafe-inline'
//   Next.js App Router injects inline <script> tags for hydration and RSC
//   payloads. Removing 'unsafe-inline' requires nonce-based CSP which needs
//   per-request nonce propagation through the entire rendering tree. Deferred
//   to a future pass. 'unsafe-eval' is NOT included — production Next.js builds
//   do not require eval.
//
// style-src 'unsafe-inline'
//   Tailwind CSS v4 and next-themes inject inline styles. Required for correct
//   rendering of the design token system and theme switching.
//
// img-src data:
//   markdown content may include data: URI inline images (e.g. base64 diagrams).
//   sanitize-html allows data: src on <img> elements after sanitization.
//
// img-src https:
//   Notes may reference external images via https. Restricting to specific
//   origins would break standard markdown image syntax.
//
// connect-src https://*.supabase.co wss://*.supabase.co
//   Supabase SSR auth, data queries, and Storage signed URL downloads go to
//   the project's *.supabase.co domain. wss: covers Supabase Realtime
//   WebSocket connections (present in the Supabase client library).
//
// font-src 'self'
//   Geist is bundled via the geist npm package — no external font CDN needed.
//
// frame-src 'none'
//   Context Store renders no iframes. Block all framing.
//
// object-src 'none'
//   No plugin content (Flash, Java applets, etc.) is used or expected.
//
// base-uri 'self'
//   Prevent <base> tag injection attacks that redirect relative URLs.
//
// form-action 'self'
//   All form submissions go to the same origin. Prevent external POST targets.
//
// ── Known limitations ──────────────────────────────────────────────────────────
//   'unsafe-inline' for scripts reduces script injection protection. This is the
//   standard constraint for Next.js apps without nonce-based CSP infrastructure.
//   A nonce-based upgrade is tracked as a post-private-beta improvement.

const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: ContentSecurityPolicy,
  },
  // Prevent the browser from MIME-sniffing a response away from the declared content-type.
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // Block clickjacking by refusing to render in frames from other origins.
  // Belt-and-suspenders alongside CSP frame-src 'none'.
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  // Enable basic XSS filter in older browsers.
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  // Do not send Referer when navigating away from the app.
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // Limit browser feature usage.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply security headers to all routes.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry source-map upload logs in CI — they are noisy and
  // not actionable. Upload will still run when SENTRY_AUTH_TOKEN is set.
  silent: true,
});
