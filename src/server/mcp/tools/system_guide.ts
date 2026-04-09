import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client/canonical_api_client.js";
import { toErrorString } from "../errors.js";

/**
 * get_system_guide
 *
 * Returns the static system guide that describes Context Store's data model,
 * entity definitions, relationship types, retrieval rules, and write rules.
 * Call this first when orienting to a new Context Store workspace.
 */
export function registerSystemGuideTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "get_system_guide",
    {
      description:
        "Returns the system guide for this Context Store workspace. " +
        "The guide explains the data model (boxes, folders, notes, links), " +
        "note kinds, relationship types, and how to navigate the knowledge base. " +
        "Call this first when you need to understand the workspace structure.",
      inputSchema: {},
    },
    async () => {
      try {
        const guide = await client.getSystemGuide();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(guide, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: toErrorString(err) }],
        };
      }
    }
  );
}
