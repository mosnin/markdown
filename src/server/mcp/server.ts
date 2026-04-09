/**
 * MCP server factory.
 *
 * Creates and configures a McpServer with all registered tools.
 * Transport wiring is handled by the entrypoint (index.ts) so this
 * module stays testable and transport-agnostic.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpConfig } from "./config.js";
import { createApiClient } from "./client/canonical_api_client.js";
import { registerAllTools } from "./tools/register_tools.js";

export function createMcpServer(config: McpConfig): McpServer {
  const server = new McpServer(
    {
      name: "context-store",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const client = createApiClient(config);
  registerAllTools(server, client);

  return server;
}
