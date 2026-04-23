# src/server/mcp

Legacy stdio MCP server for Context Store.

This package starts a local stdio MCP server (`pnpm mcp`) that proxies to the
canonical `/api/v1/**` HTTP routes using a connection bearer secret
(`csk_v1_...`). It is primarily intended for first-party/local workflows.

For connector-style integrations, use the OAuth 2.1 HTTP MCP endpoint at
`/api/mcp` (see `docs/mcp_v1.md`).

## Scope and auth model

- **Transport:** stdio (MCP SDK `StdioServerTransport`)
- **Auth to app API:** `CONTEXT_STORE_CONNECTION_SECRET=csk_v1_...`
- **Identity model:** per-process (single connection secret for the server process)
- **Authorization model:** connection permission mode + connection box scopes

## Tools exposed by this stdio server

### Read tools (9)

- `get_system_guide`
- `list_boxes`
- `get_box_guide`
- `get_box_overview`
- `list_folder_contents`
- `get_note`
- `get_linked_notes`
- `search_notes`
- `get_context_bundle`

### Write tools (3)

- `create_write_proposal`
- `list_write_proposals`
- `create_generated_note`

### Not exposed here

- OAuth branch tools (`create_branch`, `write_to_branch`, `get_branch_diff`,
  `list_branches`) are part of the HTTP MCP `/api/mcp` surface, not this
  stdio package.

## Quick start

```bash
# Set env vars
export CONTEXT_STORE_API_BASE_URL=http://localhost:3000
export CONTEXT_STORE_CONNECTION_SECRET=csk_v1_...

# Start the app first, then:
pnpm mcp
```

## File map

- `index.ts` — stdio entrypoint
- `server.ts` — `McpServer` factory
- `config.ts` — env validation
- `errors.ts` — API error mapping
- `client/canonical_api_client.ts` — HTTP client for canonical `/api/v1/**`
- `tools/register_tools.ts` — central tool registration
- `tools/system_guide.ts` — system guide tool
- `tools/boxes.ts` — boxes/overview tools
- `tools/notes.ts` — note/navigation/search tools
- `tools/bundles.ts` — context bundle tool
- `tools/write_proposals.ts` — proposal/generated-note tools

See `docs/mcp_v1.md` for full MCP documentation (stdio + OAuth HTTP surfaces).
