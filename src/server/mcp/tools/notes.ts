import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client/canonical_api_client.js";
import { toErrorString } from "../errors.js";

/**
 * list_folder_contents
 *
 * Lists folders and notes at one level of the box hierarchy.
 */
export function registerListFolderContentsTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "list_folder_contents",
    {
      description:
        "Lists the folders and notes at one level of the box hierarchy. " +
        "Omit folder_id to list the box root. Provide folder_id to list a subfolder. " +
        "Only active (non-trashed, non-archived) content is returned. " +
        "Use this to navigate the hierarchy and find note IDs for get_note.",
      inputSchema: {
        box_id: z.string().describe("ID of the box to browse"),
        folder_id: z
          .string()
          .optional()
          .describe(
            "ID of the folder to list contents of. Omit to list the box root."
          ),
      },
    },
    async ({ box_id, folder_id }) => {
      try {
        const contents = await client.listFolderContents(box_id, folder_id ?? null);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(contents, null, 2),
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
 * get_note
 *
 * Returns a single note by ID, including its full markdown body.
 */
export function registerGetNoteTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "get_note",
    {
      description:
        "Returns a single note by ID, including its full markdown content. " +
        "Also returns the note's summary, tags, read_hint, kind, and status. " +
        "Trashed notes are treated as not found. Use list_folder_contents or " +
        "search_notes to discover note IDs.",
      inputSchema: {
        note_id: z.string().describe("ID of the note to retrieve"),
      },
    },
    async ({ note_id }) => {
      try {
        const note = await client.getNote(note_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(note, null, 2),
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
 * get_linked_notes
 *
 * Returns all notes linked to or from the given note, with relationship metadata.
 */
export function registerGetLinkedNotesTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "get_linked_notes",
    {
      description:
        "Returns all notes explicitly linked to or from the given note. " +
        "Each link has a relationship_type (e.g. 'related', 'supports', 'contradicts') " +
        "and direction ('outgoing' or 'incoming'). Only notes in the connection's " +
        "allowed boxes are returned. Trashed notes are excluded.",
      inputSchema: {
        note_id: z.string().describe("ID of the note to get links for"),
      },
    },
    async ({ note_id }) => {
      try {
        const result = await client.getLinkedNotes(note_id);
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
 * search_notes
 *
 * Full-text search within a box.
 */
export function registerSearchNotesTool(server: McpServer, client: ApiClient) {
  server.registerTool(
    "search_notes",
    {
      description:
        "Full-text search for notes within a box using Postgres FTS. " +
        "Returns ranked results with title, slug, summary, tags, and path. " +
        "Search is always box-scoped — provide box_id. " +
        "Empty query returns no results. Limit defaults to 20, max 50.",
      inputSchema: {
        box_id: z.string().describe("ID of the box to search within"),
        query: z.string().describe("Search query string"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of results to return (default 20, max 50)"),
      },
    },
    async ({ box_id, query, limit }) => {
      try {
        const result = await client.searchNotes(box_id, query, limit ?? 20);
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
