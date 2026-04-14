/**
 * Resolve the externally reachable base URL for OAuth + MCP discovery.
 *
 * Priority order keeps production deterministic while preserving a
 * sensible localhost fallback.
 */
export function getPublicAppUrl(): string {
  const raw = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_CANONICAL_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000"
  ).trim();

  const withProto = /^https?:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  return withProto.replace(/\/$/, "");
}
