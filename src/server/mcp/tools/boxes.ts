import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client/canonical_api_client.js";
import { toErrorString } from "../errors.js";

/**
 * list_boxes
 *
 * Lists all boxes this connection has access to.
 */
export function registerListBoxesTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "list_boxes",
    {
      description:
        "Lists all boxes (knowledge bases) this connection is scoped to. " +
        "Each box has a name, slug, description, and optional guide note. " +
        "Use the returned box IDs for subsequent calls like get_box_guide, " +
        "get_box_overview, list_folder_contents, and search_notes.",
      inputSchema: {},
    },
    async () => {
      try {
        const boxes = await client.listBoxes();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(boxes, null, 2),
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

/**
 * get_box_guide
 *
 * Returns the guide note for a box, or null if none is assigned.
 */
export function registerGetBoxGuideTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "get_box_guide",
    {
      description:
        "Returns the guide note for the specified box. The guide note explains " +
        "what the box contains, how notes are organized within it, and any " +
        "domain-specific conventions. Returns null if the box has no guide note. " +
        "Call this after list_boxes to understand a specific box before diving in.",
      inputSchema: {
        box_id: z.string().describe("ID of the box"),
      },
    },
    async ({ box_id }) => {
      try {
        const result = await client.getBoxGuide(box_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
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

/**
 * get_box_overview
 *
 * Returns the full hierarchy (folders, notes) and link graph for a box.
 */
export function registerGetBoxOverviewTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "get_box_overview",
    {
      description:
        "Returns the complete folder/note hierarchy and link graph for a box. " +
        "Nodes are folders and notes; edges are note links with relationship types. " +
        "Use this to understand the shape of a box before navigating into it. " +
        "Hard limits: 1000 nodes, 2000 edges. When truncated, data.truncated is true.",
      inputSchema: {
        box_id: z.string().describe("ID of the box"),
      },
    },
    async ({ box_id }) => {
      try {
        const overview = await client.getBoxOverview(box_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(overview, null, 2),
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
