# MCP Server V1

Context Store ships a read-only MCP (Model Context Protocol) server that exposes the canonical `/api/v1` routes as MCP tools. AI clients (Claude Desktop, Cursor, Windsurf, etc.) can connect to it and retrieve structured knowledge from any box they have access to.

---

## Architecture

```
AI Client (Claude Desktop, etc.)
  ↓  stdio / MCP protocol
src/server/mcp/index.ts        (entrypoint — StdioServerTransport)
  ↓
src/server/mcp/server.ts       (McpServer factory)
  ↓
src/server/mcp/tools/          (9 read tools)
  ↓  HTTP + Bearer csk_v1_...
/api/v1/*                      (canonical Next.js API routes)
  ↓
Supabase (admin client, app-level auth filters)
```

The MCP server is **stateless** and **read-only**. It proxies every tool call to the canonical API over HTTP. It never imports internal app services, repositories, or the Supabase client directly — the API surface is the contract.

---

## Available tools

| Tool | API route | Description |
|---|---|---|
| `get_system_guide` | `GET /api/v1/system_guide` | System guide: data model, entity definitions, retrieval rules |
| `list_boxes` | `GET /api/v1/boxes` | List all boxes the connection is scoped to |
| `get_box_guide` | `GET /api/v1/boxes/{id}/box_guide` | Box guide note (or null if unset) |
| `get_box_overview` | `GET /api/v1/boxes/{id}/box_overview` | Full hierarchy + link graph for a box |
| `list_folder_contents` | `GET /api/v1/boxes/{id}/folder_contents` | Folders and notes at one hierarchy level |
| `get_note` | `GET /api/v1/notes/{id}` | Single note with full markdown body |
| `get_linked_notes` | `GET /api/v1/notes/{id}/linked_notes` | Notes linked to/from a note with relationship metadata |
| `search_notes` | `POST /api/v1/search_notes` | Full-text search within a box |
| `get_context_bundle` | `POST /api/v1/context_bundles` | Bounded, deduplicated context bundle centered on a note |

No write tools. No export tools. Resources and prompts are not registered in V1.

---

## File map

| File | Purpose |
|---|---|
| `src/server/mcp/index.ts` | Main entrypoint — loads config, wires stdio transport |
| `src/server/mcp/server.ts` | `McpServer` factory — registers tools, transport-agnostic |
| `src/server/mcp/config.ts` | Env validation — `CONTEXT_STORE_API_BASE_URL`, `CONTEXT_STORE_CONNECTION_SECRET` |
| `src/server/mcp/errors.ts` | `ApiError` type + error string mapper |
| `src/server/mcp/client/canonical_api_client.ts` | HTTP client for all `/api/v1` routes |
| `src/server/mcp/tools/system_guide.ts` | `get_system_guide` tool |
| `src/server/mcp/tools/boxes.ts` | `list_boxes`, `get_box_guide`, `get_box_overview` tools |
| `src/server/mcp/tools/notes.ts` | `list_folder_contents`, `get_note`, `get_linked_notes`, `search_notes` tools |
| `src/server/mcp/tools/bundles.ts` | `get_context_bundle` tool |
| `src/server/mcp/tools/register_tools.ts` | Central registration — imports and calls all tool files |
| `tsconfig.mcp.json` | TypeScript config for standalone build (NodeNext module resolution) |

---

## Authentication

The MCP server authenticates to the canonical API using a **connection bearer secret** (`csk_v1_...`). This secret is created in Settings → Connections in the web app.

Each connection is scoped to one or more boxes. The MCP server can only read from the boxes that connection is scoped to — all access control is enforced by the canonical API, not the MCP layer.

### Security note

The MCP server process holds the raw connection secret in memory. Use OS-level process isolation and keep the secret out of logs.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `CONTEXT_STORE_API_BASE_URL` | Yes | URL of the running Context Store app, e.g. `http://localhost:3000` |
| `CONTEXT_STORE_CONNECTION_SECRET` | Yes | Bearer secret from Settings → Connections |
| `CONTEXT_STORE_MCP_LOG_LEVEL` | No | Log level: `debug`, `info` (default), `warn`, `error` |

Log output goes to **stderr**. Stdout is reserved for the MCP protocol.

---

## Running locally

### 1. Create a connection

Open the web app → Settings → Connections → New Connection. Select the boxes to scope it to, then copy the secret shown after creation (it won't be shown again).

### 2. Set env vars

```bash
# .env.mcp.local (never commit this)
CONTEXT_STORE_API_BASE_URL=http://localhost:3000
CONTEXT_STORE_CONNECTION_SECRET=csk_v1_a3f9bc12d7...
CONTEXT_STORE_MCP_LOG_LEVEL=debug
```

### 3. Start the app

```bash
pnpm dev
```

### 4. Start the MCP server

```bash
set -a; source .env.mcp.local; set +a
pnpm mcp
```

---

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "context-store": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/context-store", "mcp"],
      "env": {
        "CONTEXT_STORE_API_BASE_URL": "https://your-domain.com",
        "CONTEXT_STORE_CONNECTION_SECRET": "csk_v1_..."
      }
    }
  }
}
```

Or using the compiled build:

```json
{
  "mcpServers": {
    "context-store": {
      "command": "node",
      "args": ["/path/to/context-store/dist/mcp/index.js"],
      "env": {
        "CONTEXT_STORE_API_BASE_URL": "https://your-domain.com",
        "CONTEXT_STORE_CONNECTION_SECRET": "csk_v1_..."
      }
    }
  }
}
```

---

## Building a distributable

```bash
pnpm build:mcp
# Output: dist/mcp/
```

The compiled output is a plain Node.js ESM bundle with no dependency on Next.js.

---

## Recommended tool usage order

For an AI client orienting to a new workspace:

1. `get_system_guide` — understand data model and conventions
2. `list_boxes` — discover available knowledge bases
3. `get_box_guide` — read the guide for each relevant box
4. `get_box_overview` — see the full structure before diving in
5. `search_notes` or `list_folder_contents` — locate relevant notes
6. `get_context_bundle` — pull rich context around a specific topic

For focused retrieval on a known note:

1. `get_context_bundle` — highest-value single call; includes linked notes, guide, and ancestor summary
2. `get_linked_notes` — follow the graph from a specific note
3. `get_note` — retrieve a specific note's full content

---

## Design decisions

**Calls API over HTTP, never imports app services directly.**
The MCP layer has no knowledge of database schemas, repository patterns, or service implementations. The canonical API is the single integration point. This means MCP and the app can evolve independently.

**9 tools, no more.**
The tool set matches the canonical read API exactly — one tool per endpoint. No synthetic aggregation, no client-side pagination (the API handles limits). Export tools are omitted: binary ZIP downloads are not useful over MCP.

**All errors returned as tool errors, not thrown.**
Network errors, auth failures, and 404s are caught and returned as `{ isError: true, content: [{ type: "text", text: "..." }] }` so the AI client receives a useful error message rather than an unhandled exception.

**stdio transport in V1.**
Simple, universally supported, works with every MCP client. HTTP+SSE transport can be added later by swapping the transport in `index.ts` without touching the tools or server factory.
