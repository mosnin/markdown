import { NextResponse } from "next/server";
import { ALL_SCOPES } from "@/server/services/oauth_scope_service";
import { getCanonicalBaseUrl } from "@/lib/canonical_url";

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

export async function GET() {
  const issuer = getCanonicalBaseUrl();
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    registration_endpoint: `${issuer}/api/oauth/register`,
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
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
