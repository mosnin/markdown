import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent the browser from MIME-sniffing a response away from the declared content-type.
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // Block clickjacking by refusing to render in frames from other origins.
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  // Enable basic XSS filter in older browsers (belt-and-suspenders alongside CSP).
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

export default nextConfig;
