/**
 * Registers all MCP tools onto the server instance.
 * Import order defines the order tools appear in the tool list.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client/canonical_api_client.js";

import { registerSystemGuideTool } from "./system_guide.js";
import {
  registerListBoxesTool,
  registerGetBoxGuideTool,
  registerGetBoxOverviewTool,
} from "./boxes.js";
import {
  registerListFolderContentsTool,
  registerGetNoteTool,
  registerGetLinkedNotesTool,
  registerSearchNotesTool,
} from "./notes.js";
import { registerGetContextBundleTool } from "./bundles.js";
import {
  registerCreateWriteProposalTool,
  registerListWriteProposalsTool,
  registerCreateGeneratedNoteTool,
} from "./write_proposals.js";

export function registerAllTools(server: McpServer, client: ApiClient): void {
  // Orientation tools — call these first
  registerSystemGuideTool(server, client);
  registerListBoxesTool(server, client);
  registerGetBoxGuideTool(server, client);
  registerGetBoxOverviewTool(server, client);

  // Navigation and retrieval
  registerListFolderContentsTool(server, client);
  registerGetNoteTool(server, client);
  registerGetLinkedNotesTool(server, client);
  registerSearchNotesTool(server, client);

  // Context assembly
  registerGetContextBundleTool(server, client);

  // Write tools (proposals and direct generated note creation)
  registerCreateWriteProposalTool(server, client);
  registerListWriteProposalsTool(server, client);
  registerCreateGeneratedNoteTool(server, client);
}
