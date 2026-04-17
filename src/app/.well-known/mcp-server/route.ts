import { NextResponse } from "next/server";
import { ALL_SCOPES } from "@/server/services/oauth_scope_service";
import { getCanonicalBaseUrl } from "@/lib/canonical_url";

/**
 * MCP server discovery metadata.
 *
 * Connectors that speak the MCP protocol can fetch this document to
 * discover:
 *
 *   * The URL of the HTTP MCP endpoint to POST JSON-RPC 2.0 to.
 *   * The authorization server they should send the user to for
 *     consent (via .well-known/oauth-authorization-server).
 *   * The capability scopes the server supports, so the connector
 *     can request the minimal set it actually needs.
 *
 * This is adjacent to (not a replacement for) RFC 8414
 * `/.well-known/oauth-authorization-server` metadata. OAuth discovery
 * describes the authorization server; this document describes the
 * MCP resource it protects.
 */

export async function GET() {
  const issuer = getCanonicalBaseUrl();
  return NextResponse.json(
    {
      mcp_server_url: `${issuer}/api/mcp`,
      protocol: "json-rpc-2.0",
      transport: "http",
      authorization_server: issuer,
      authorization_server_metadata: `${issuer}/.well-known/oauth-authorization-server`,
      protected_resource_metadata: `${issuer}/api/mcp`,
      supported_scopes: ALL_SCOPES,
      bearer_methods_supported: ["header"],
      service_documentation: `${issuer}/docs/mcp_v1.md`,
      architecture_documentation: `${issuer}/docs/mcp_auth_architecture_foundation_v1.md`,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}
