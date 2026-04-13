# MCP Server V1

> **Primary auth flow is OAuth 2.1 + PKCE over HTTP.**
>
> The stdio `csk_v1_` flow documented later in this file is
> deprecated and retained for first-party local dev only. New
> integrators should use:
>
> 1. **Discover:** `GET /.well-known/oauth-authorization-server`
>    and `GET /.well-known/mcp-server`.
> 2. **Register a client** (one-time, RFC 7591):
>    `POST /api/oauth/register` with a `client_name`,
>    `redirect_uris`, `scope`, and `token_endpoint_auth_method`.
>    Public (native) clients get `none`; confidential clients get
>    `client_secret_post`/`client_secret_basic` and receive a
>    one-time `client_secret` in the response.
> 3. **Authorize:** redirect the user to
>    `/oauth/authorize?response_type=code&client_id=<>&redirect_uri=<>&scope=<scope-list>&state=<>&code_challenge=<S256>`.
>    Context Store shows a consent screen that lists the requested
>    scopes, the target workspace, and the client identity.
> 4. **Exchange code:** `POST /api/oauth/token` with
>    `grant_type=authorization_code`, `code`, `code_verifier`,
>    `client_id`, and (confidential only) `client_secret`. Response
>    returns `{ access_token: "cso_a_…", refresh_token:
>    "cso_r_…", expires_in: 3600, scope }`.
> 5. **Call MCP:** `POST ${NEXT_PUBLIC_APP_URL}/api/mcp` with
>    `Authorization: Bearer <access_token>` and a JSON-RPC 2.0
>    body (`initialize`, `tools/list`, `tools/call`).
> 6. **Refresh:** `POST /api/oauth/token` with
>    `grant_type=refresh_token` + the refresh token. Each refresh
>    rotates both tokens; reuse of a retired refresh revokes the
>    whole family.
> 7. **Revoke:** `POST /api/oauth/revoke` (RFC 7009) or delete the
>    consent from the admin UI.
>
> See `mcp_auth_architecture_foundation_v1.md` for the full
> architecture and
> `mcp_oauth_and_secure_connector_architecture_v1.md` for the
> OAuth server design.

Context Store ships an MCP (Model Context Protocol) server that exposes the canonical `/api/v1` routes as MCP tools. AI clients (Claude Desktop, Cursor, Windsurf, etc.) can connect to it and retrieve structured knowledge from any box they have access to, and — with the appropriate connection permission — submit write proposals or create generated notes.

---

## Architecture

```
AI Client (Claude Desktop, etc.)
  ↓  stdio / MCP protocol
src/server/mcp/index.ts        (entrypoint — StdioServerTransport)
  ↓
src/server/mcp/server.ts       (McpServer factory)
  ↓
src/server/mcp/tools/          (9 read tools + 3 write tools)
  ↓  HTTP + Bearer csk_v1_...
/api/v1/*                      (canonical Next.js API routes)
  ↓
Supabase (admin client, app-level auth filters)
```

The MCP server is **stateless**. It proxies every tool call to the canonical API over HTTP. It never imports internal app services, repositories, or the Supabase client directly — the API surface is the contract.

---

## Available tools

### Read tools (9)

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

### Write tools (3)

Available to connections with `propose_writes` or `generate_in_allowed_folders` permission.

| Tool | API route | Permission required | Description |
|---|---|---|---|
| `create_write_proposal` | `POST /api/v1/write_proposals` | `propose_writes` or `generate_in_allowed_folders` | Propose a note change (create/update/append/replace) for human review |
| `list_write_proposals` | `GET /api/v1/write_proposals` | `propose_writes` or `generate_in_allowed_folders` | List proposals submitted by this connection |
| `create_generated_note` | `POST /api/v1/generated_notes` | `generate_in_allowed_folders` only | Create a note directly in a pre-authorized folder (no human review) |

**Write tool constraints:**
- `read_only` connections cannot call any write tool.
- `create_generated_note` requires both `generate_in_allowed_folders` permission AND the target folder having `accepts_generated_notes = true`.
- Approval and rejection of proposals is not available through MCP. Humans review and act on proposals at `/app/proposals`.

No export tools. Resources and prompts are not registered in V1.

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
| `src/server/mcp/tools/write_proposals.ts` | `create_write_proposal`, `list_write_proposals`, `create_generated_note` tools |
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

**12 tools total: 9 read + 3 write.**
Read tools match the canonical read API exactly — one tool per endpoint. Write tools match the 3 write endpoints added in V1. No synthetic aggregation, no client-side pagination (the API handles limits). Export tools are omitted: binary ZIP downloads are not useful over MCP.

**All errors returned as tool errors, not thrown.**
Network errors, auth failures, and 404s are caught and returned as `{ isError: true, content: [{ type: "text", text: "..." }] }` so the AI client receives a useful error message rather than an unhandled exception.

**stdio transport in V1.**
Simple, universally supported, works with every MCP client. HTTP+SSE transport can be added later by swapping the transport in `index.ts` without touching the tools or server factory.

## Extension: HTTP MCP transport with OAuth 2.1 (v1.1)

A second, connector-facing transport now lives at `/api/mcp`. It
speaks JSON-RPC 2.0 over HTTP POST, authenticates via an OAuth 2.1
bearer token in the Authorization header (no token in URL), and is
what Claude Desktop / OpenAI Apps / custom connectors should use.

Key differences from the stdio transport:

- **Per-request identity.** The bearer token is resolved to a
  specific user + workspace + scope on every call, so audit
  attribution names the real human who consented. The stdio transport
  uses a workspace-wide connection token loaded from an env var.
- **OAuth authorize + token endpoints.** Connectors walk the user
  through a consent screen; tokens refresh every hour and rotate
  every 30 days. The stdio transport has no such flow — the operator
  pastes a bearer token into an env var.
- **Scope-gated tool set.** `tools/list` returns only the tools the
  token's scopes cover. Write tools additionally reject viewer role.
- **Discoverable** via `/.well-known/oauth-authorization-server` and
  RFC 9728 protected-resource metadata at `GET /api/mcp`.

See
[`docs/mcp_oauth_and_secure_connector_architecture_v1.md`](mcp_oauth_and_secure_connector_architecture_v1.md)
for the full architecture, including the scope table, token model,
and legacy migration guidance. The stdio transport is preserved for
local development and deployments already using env-var auth; new
connector-style integrations should use HTTP + OAuth.

## OAuth product surface status (2026-04-13)

- `/oauth/authorize` is a production consent UI (client identity, scopes, workspace selector, box narrowing, approve/deny).
- `/api/oauth/token` enforces 1h access-token TTL and 30d rotating refresh tokens.
- `/api/oauth/revoke` revokes bearer credentials without leaking token existence.
- Settings includes:
  - **Connected apps** (user grant management + revoke)
  - **Developer apps** (OAuth client registration, one-time secret reveal, rotation, delete/revoke)
- OAuth-backed writes remain branch-safe by using existing canonical API write semantics. Branch targeting is not separately requested by OAuth tokens; behavior remains equivalent to current API write defaults.

## Launch policy update (2026-04-13)

- Connector-grade HTTP MCP (`/api/mcp`) is OAuth-only.
- Legacy `csk_v1_` tokens remain migration/dev-only and are not accepted on `/api/mcp`.
- See `docs/mcp_connector_compatibility_and_launch_readiness_v1.md` for troubleshooting and launch checks.

## OAuth write branch policy (final)

OAuth-backed writes are intentionally main-only in V1. Branch-targeting fields are rejected explicitly rather than silently ignored.
