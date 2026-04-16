/**
 * Canonical base URL resolution.
 *
 * All OAuth / MCP discovery documents must agree on a single absolute
 * origin (issuer) for their URLs. Connectors fetch
 * `/.well-known/oauth-authorization-server`,
 * `/.well-known/mcp-server`, and `/api/mcp` (RFC 9728) during discovery
 * and cross-check the issuer — inconsistent origins break authorization
 * silently on Vercel preview deployments where `CANONICAL_URL` isn't
 * set explicitly.
 *
 * The resolution order is:
 *
 *   1. `NEXT_PUBLIC_CANONICAL_URL` — the preferred, explicit public
 *      origin for production / preview deployments.
 *   2. `NEXT_PUBLIC_APP_URL` — already set on Vercel (used by auth
 *      callbacks, see `src/lib/env.ts`), so it's the most reliable
 *      fallback for preview URLs when no explicit canonical URL is
 *      provided.
 *   3. `NEXT_PUBLIC_SITE_URL` — historical env name, kept for
 *      compatibility.
 *   4. `VERCEL_URL` — Vercel injects this automatically on every
 *      deployment; it does not include the scheme.
 *   5. `http://localhost:3000` — local development default.
 *
 * The returned value is normalised so callers can safely interpolate it
 * with a leading slash path (no trailing slash, always has scheme).
 */
export function getCanonicalBaseUrl(): string {
  const explicit =
    process.env.NEXT_PUBLIC_CANONICAL_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;

  if (explicit && explicit.trim().length > 0) {
    return normaliseBaseUrl(explicit);
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl && vercelUrl.trim().length > 0) {
    // VERCEL_URL is provided without a scheme; all Vercel deployments
    // are HTTPS, so prefix accordingly.
    return normaliseBaseUrl(`https://${vercelUrl}`);
  }

  return "http://localhost:3000";
}

function normaliseBaseUrl(raw: string): string {
  let out = raw.trim();
  // Ensure a scheme is present; default to https for non-localhost hosts.
  if (!/^https?:\/\//i.test(out)) {
    out = out.startsWith("localhost") || out.startsWith("127.")
      ? `http://${out}`
      : `https://${out}`;
  }
  // Strip any trailing slash so callers can always do `${base}/path`.
  return out.replace(/\/+$/, "");
}
