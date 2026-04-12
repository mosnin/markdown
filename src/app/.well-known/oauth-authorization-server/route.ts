import { NextResponse } from "next/server";
import { ALL_SCOPES } from "@/server/services/oauth_scope_service";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Connectors read this document during discovery to learn where to
 * send the user for authorization, where to exchange codes for tokens,
 * and what grants / response types / PKCE methods we accept. Serving
 * it from the standard well-known path means Claude Desktop, OpenAI
 * apps, and any off-the-shelf OAuth client can discover us without
 * hand configuration.
 */

function baseUrl(): string {
  // Respect an explicit canonical URL if configured (production
  // deployments set this so metadata is correct even when rendered
  // behind a proxy), otherwise fall back to the Next.js runtime URL.
  return (
    process.env.NEXT_PUBLIC_CANONICAL_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "").replace(/^https?:\/\//, (m) => m === "http://" && !process.env.VERCEL_URL ? m : "https://");
}

export async function GET() {
  const issuer = baseUrl();
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ALL_SCOPES,
    // RFC 9728 protected resource metadata path (served by the MCP endpoint).
    resource_documentation: `${issuer}/docs/mcp_oauth_and_secure_connector_architecture_v1.md`,
    service_documentation: `${issuer}/docs/mcp_v1.md`,
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
