import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client/canonical_api_client.js";
import { toErrorString } from "../errors.js";

/**
 * get_context_bundle
 *
 * Assembles a bounded, deterministic context bundle centered on a note.
 * Includes the target note, guide note, linked notes, ancestor summary note,
 * and relationship edges — all ranked and deduplicated by the server.
 *
 * This is the single most powerful retrieval tool: prefer it over fetching
 * individual notes when you need rich context around a topic.
 */
export function registerGetContextBundleTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "get_context_bundle",
    {
      description:
        "Assembles a rich context bundle centered on a note. " +
        "The bundle includes the target note, its box guide note, " +
        "linked notes (with relationship metadata), an ancestor summary note, " +
        "and all relationship edges — ranked and deduplicated. " +
        "This is the highest-value retrieval tool: use it when you need thorough " +
        "context around a specific topic or entity rather than fetching notes one by one.",
      inputSchema: {
        note_id: z
          .string()
          .describe("ID of the central note to build context around"),
        include_guide: z
          .boolean()
          .optional()
          .describe("Include the box guide note in the bundle (default true)"),
        include_ancestor_summary: z
          .boolean()
          .optional()
          .describe(
            "Include the folder ancestor summary note in the bundle (default true)"
          ),
        include_archived: z
          .boolean()
          .optional()
          .describe("Include archived notes in linked results (default false)"),
        linked_limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe(
            "Maximum number of linked notes to include (default 10, max 10)"
          ),
      },
    },
    async ({ note_id, include_guide, include_ancestor_summary, include_archived, linked_limit }) => {
      try {
        const bundle = await client.getContextBundle({
          note_id,
          include_guide: include_guide ?? true,
          include_ancestor_summary: include_ancestor_summary ?? true,
          include_archived: include_archived ?? false,
          linked_limit: linked_limit ?? 10,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(bundle, null, 2),
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
