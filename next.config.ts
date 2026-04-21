import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// ─── Security headers ────────────────────────────────────────────────────────
//
// Content-Security-Policy is set dynamically per-request in middleware.ts using a
// nonce-based policy. Only non-CSP security headers are defined here as static
// headers (they don't need per-request nonces).

const securityHeaders = [
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
  // Enforce HTTPS for this origin and all subdomains, and mark the domain
  // as eligible for the HSTS preload list.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
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
      // ── Edge caching for public marketing pages ────────────────────────
      // These pages are statically generated with ISR (revalidate=3600)
      // but we also set s-maxage so CDN / edge proxies in front of the
      // origin can serve cached HTML without hitting the origin at all.
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/features",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/pricing",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      // ── Stable API / discovery endpoints ───────────────────────────────
      {
        source: "/.well-known/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/api/v1/system_guide",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry source-map upload logs in CI — they are noisy and
  // not actionable. Upload will still run when SENTRY_AUTH_TOKEN is set.
  silent: true,
});
