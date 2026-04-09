# src/server/mcp

Model Context Protocol server implementation for Context Store.

## Planned contents

- `server.ts` — MCP server entry point
- `tools/` — MCP tool definitions (read_note, search_context, list_boxes, etc.)
- `resources/` — MCP resource definitions (workspace, box, note as resources)
- `prompts/` — MCP prompt definitions for guided context retrieval

## Conventions

- MCP tools call services, never repositories directly
- Tools respect the same authorization policies as the HTTP API
- Tool inputs and outputs are typed with zod
- MCP server runs as a Next.js API route or standalone process

## Not yet implemented

Deferred to the MCP integration prompt.
