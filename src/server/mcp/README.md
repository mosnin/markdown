# src/server/mcp

Read-only MCP (Model Context Protocol) server for Context Store.

Exposes 9 read tools that proxy to the canonical `/api/v1` routes over HTTP.
Authenticates using a connection bearer secret (`csk_v1_...`) from Settings → Connections.

## Quick start

```bash
# Set env vars
export CONTEXT_STORE_API_BASE_URL=http://localhost:3000
export CONTEXT_STORE_CONNECTION_SECRET=csk_v1_...

# Start the app first, then:
pnpm mcp
```

## Tools

| Tool | Description |
|---|---|
| `get_system_guide` | System guide: data model, entity definitions, retrieval rules |
| `list_boxes` | List all boxes the connection is scoped to |
| `get_box_guide` | Box guide note (or null) |
| `get_box_overview` | Full hierarchy + link graph |
| `list_folder_contents` | Folders and notes at one hierarchy level |
| `get_note` | Single note with full markdown body |
| `get_linked_notes` | Notes linked to/from a note |
| `search_notes` | Full-text search within a box |
| `get_context_bundle` | Bounded, deduplicated context bundle centered on a note |

## Files

- `index.ts` — Main entrypoint (stdio transport)
- `server.ts` — McpServer factory (transport-agnostic)
- `config.ts` — Env validation
- `errors.ts` — ApiError type and error mapper
- `client/canonical_api_client.ts` — HTTP client for /api/v1 routes
- `tools/register_tools.ts` — Central tool registration
- `tools/system_guide.ts` — get_system_guide
- `tools/boxes.ts` — list_boxes, get_box_guide, get_box_overview
- `tools/notes.ts` — list_folder_contents, get_note, get_linked_notes, search_notes
- `tools/bundles.ts` — get_context_bundle

See [docs/mcp_v1.md](../../../docs/mcp_v1.md) for full documentation.
