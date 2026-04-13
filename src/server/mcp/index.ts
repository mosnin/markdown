#!/usr/bin/env node
/**
 * Context Store MCP Server — stdio entrypoint (LEGACY).
 *
 * @deprecated This stdio entrypoint is retained for first-party local
 * development only. It consumes a long-lived csk_v1_ token from an
 * environment variable, which is not compatible with Claude Desktop,
 * OpenAI Apps, or any OAuth 2.1 connector flow.
 *
 * The primary public MCP surface is:
 *
 *   HTTP POST ${NEXT_PUBLIC_APP_URL}/api/mcp
 *   Authorization: Bearer <OAuth 2.1 access token>
 *
 * Discovery: /.well-known/oauth-authorization-server
 * Docs:      docs/mcp_v1.md and docs/mcp_auth_architecture_foundation_v1.md
 *
 * To run this legacy stdio server you MUST explicitly opt in:
 *
 *   CONTEXT_STORE_LEGACY_CSK_ENABLED=true
 *   CONTEXT_STORE_API_BASE_URL=http://localhost:3000
 *   CONTEXT_STORE_CONNECTION_SECRET=csk_v1_...
 *   npx tsx src/server/mcp/index.ts
 *
 * Sunset target: the next major release cuts csk_v1_ entirely.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";

function checkLegacyOptIn(): void {
  const optedIn = process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED === "true";
  const isProduction = process.env.NODE_ENV === "production";

  if (!optedIn) {
    process.stderr.write(
      "[context-store-mcp] DEPRECATED: the stdio MCP server uses the " +
        "legacy csk_v1_ token flow. Migrate to the HTTP OAuth flow at " +
        "/api/mcp. See docs/mcp_auth_architecture_foundation_v1.md.\n"
    );
    if (isProduction) {
      process.stderr.write(
        "[context-store-mcp] Refusing to start: NODE_ENV=production and " +
          "CONTEXT_STORE_LEGACY_CSK_ENABLED is not 'true'.\n"
      );
      process.exit(2);
    }
    process.stderr.write(
      "[context-store-mcp] Continuing in non-production mode. Set " +
        "CONTEXT_STORE_LEGACY_CSK_ENABLED=true to silence this warning.\n"
    );
  }
}

async function main() {
  checkLegacyOptIn();

  const config = loadConfig();

  if (config.logLevel === "debug") {
    process.stderr.write(
      `[context-store-mcp] Connecting to ${config.apiBaseUrl}\n`
    );
  }

  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  if (config.logLevel === "debug") {
    process.stderr.write("[context-store-mcp] Server ready (stdio transport)\n");
  }
}

main().catch((err) => {
  process.stderr.write(`[context-store-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
