import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// ─── Security headers ────────────────────────────────────────────────────────
//
// Content-Security-Policy is set dynamically per-request in proxy.ts using a
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
