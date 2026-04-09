#!/usr/bin/env node
/**
 * Context Store MCP Server — stdio entrypoint.
 *
 * Usage:
 *   CONTEXT_STORE_API_BASE_URL=http://localhost:3000 \
 *   CONTEXT_STORE_CONNECTION_SECRET=csk_v1_... \
 *   npx tsx src/server/mcp/index.ts
 *
 * Or via the package scripts:
 *   pnpm mcp          (uses .env.mcp.local for env vars)
 *   pnpm build:mcp    (compiles to dist/mcp/)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";

async function main() {
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
