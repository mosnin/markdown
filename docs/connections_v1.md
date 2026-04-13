# Connections V1

> **Deprecated as the primary MCP auth flow.**
>
> The `csk_v1_` connection-token flow described below is retained
> only for first-party local development. All new integrations —
> Claude Desktop, OpenAI Apps, custom remote agents, etc. — must
> use the OAuth 2.1 + PKCE flow documented in
> [`mcp_v1.md`](./mcp_v1.md) and
> [`mcp_auth_architecture_foundation_v1.md`](./mcp_auth_architecture_foundation_v1.md).
>
> Runtime use of `csk_v1_` tokens requires the explicit opt-in env
> flag `CONTEXT_STORE_LEGACY_CSK_ENABLED=true`; the stdio MCP
> entrypoint refuses to start in `NODE_ENV=production` without it,
> and the HTTP MCP auth adapter rejects legacy tokens unless the
> flag is set. Every deprecated-token use emits an
> `mcp.legacy_token_used` audit event (rate-limited per token to
> 1/hour) and attaches `Deprecation: true`, `Link`, and `Warning`
> response headers.
>
> Migration path: register an OAuth client via
> `POST /api/oauth/register`, walk the user through
> `/oauth/authorize`, exchange the returned code at
> `/api/oauth/token`, then call `/api/mcp` with the `cso_a_` access
> token. See `mcp_v1.md` for a worked example.

Connections are the external trust boundary for Context Store. Each connection represents an authorized external agent (MCP client, API integration, script) and carries a bearer token for authentication.

---

## Overview

```
Human workspace
  └── Connection (API / MCP / Webhook)
        ├── ConnectionToken (active bearer secret)
        └── ConnectionBoxScope[]  (which boxes are accessible)
```

A connection scopes an external agent to one or more boxes within your workspace. It does not grant workspace-level access.

---

## Connection lifecycle

### Create

Creating a connection generates a bearer token and displays it once. The raw secret is never stored — only the prefix (for lookup) and the hash (for verification) are persisted.

Steps:
1. Open **Settings → Connections**.
2. Click **New connection**.
3. Fill in name, type, permission mode, and select the boxes to allow.
4. Copy and store the generated token securely.

### Token format

```
csk_v1_<64 hex chars>
```

Example: `csk_v1_a3f9bc12...` (truncated for readability)

The token is a single string used as the bearer credential:

```
Authorization: Bearer csk_v1_<64hex>
```

### Rotate

Rotating a token immediately revokes the current active token and generates a new one. The new token is shown once.

Use token rotation if:
- You suspect a token was leaked.
- You want to periodically cycle credentials.

### Revoke

Revoking a connection:
1. Revokes all active tokens for the connection.
2. Sets the connection status to `revoked`.
3. Revoked connections cannot be reactivated — create a new connection instead.

---

## Permission modes

| Mode | Description |
|---|---|
| `read_only` | May only read notes, folders, and metadata. No writes. |
| `propose_writes` | May submit write proposals for human review. Cannot write directly. |
| `generate_in_allowed_folders` | May write directly to folders where `accepts_generated_notes = true`. Also submits write proposals for object changes. |

### Reusable shared object restriction

Regardless of permission mode, external connections **cannot directly mutate** workspace-shared (reusable) Skills or Agents. All writes to reusable objects must go through the write proposal system. This is enforced by `connectionCanDirectlyWrite()` in `object_trust_policy_service.ts` before any write is attempted.

Box-scoped connections only see reusable objects that are explicitly attached to their allowed boxes. They cannot discover or propose changes to unattached workspace-shared objects.

---

## Box scopes

Box is the authorization scope unit in V1. A connection can be scoped to one or more boxes. Access to a box grants:
- Reading any note or folder within the box
- Searching within the box
- Exporting the box or its contents

Connections with no box scopes have no data access — all data endpoints return `403 Forbidden`.

---

## Token verification

Verification is performed on every API request:

1. Parse `Authorization: Bearer csk_v1_<hex>` header.
2. Extract `token_prefix = hex[0:8]`.
3. DB lookup: `connection_tokens WHERE token_prefix = ? AND status = 'active'`.
4. Check `expires_at` (if set).
5. Compute `sha256(hex)`, compare to stored `secret_hash` using **constant-time** `timingSafeEqual`.
6. Load parent connection; verify `status = 'active'`.
7. Load `connection_box_scopes` → build `allowedBoxIds` set.

If any step fails, the request receives `401 Unauthorized`.

The admin Supabase client (service role key) is used for token lookup — this is intentional because API requests have no user session. All ownership filtering is applied explicitly in application code.

---

## Database schema

### `connections`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `workspace_id` | uuid | FK → workspaces |
| `name` | text | Human label |
| `description` | text\|null | Optional description |
| `connection_type` | text | `api` \| `mcp` \| `webhook` |
| `status` | text | `active` \| `suspended` \| `revoked` |
| `permission_mode` | text | `read_only` \| `propose_writes` \| `generate_in_allowed_folders` |
| `last_used_at` | timestamptz\|null | Updated on each API request |
| `usage_count` | integer | Request counter (incremented async) |
| `metadata` | jsonb\|null | Arbitrary extension metadata |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `connection_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `connection_id` | uuid | FK → connections |
| `token_prefix` | text | First 8 hex chars — indexed for lookup |
| `secret_hash` | text | `sha256(<64hex>)` — never the raw secret |
| `label` | text\|null | `"Initial token"`, `"Rotated token"`, etc. |
| `status` | text | `active` \| `revoked` \| `expired` |
| `expires_at` | timestamptz\|null | null = never expires |
| `last_used_at` | timestamptz\|null | Updated async on each request |
| `revoked_at` | timestamptz\|null | Set when revoked |
| `created_at` | timestamptz | |

### `connection_box_scopes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `connection_id` | uuid | FK → connections |
| `box_id` | uuid | FK → boxes |
| `created_at` | timestamptz | |

---

## Audit events

All connection lifecycle events are recorded in `audit_events`:

| Event type | Trigger |
|---|---|
| `connection.created` | New connection created |
| `connection.revoked` | Connection revoked |
| `connection.updated` | Name / description / permission mode changed |
| `connection.token_rotated` | Token rotated (old revoked, new issued) |

Audit events are fire-and-forget — they do not block the primary operation if the write fails.

---

## Security notes

- **Tokens are hashed.** The raw `csk_v1_...` string is never persisted. Losing the token requires rotation.
- **Token lookup is prefix-based.** The `token_prefix` is 8 hex chars (4 bytes). This is enough for fast lookup in a small table — not intended to be secret itself.
- **Verification is constant-time.** `timingSafeEqual` prevents timing-based side-channel attacks on the hash comparison.
- **Admin client isolation.** The service role Supabase client is used only for token auth. Human-session code uses the cookie-based client. Never mix them.
- **Box scope is the only authorization boundary in V1.** There is no note-level or folder-level ACL. If a connection can access a box, it can access all non-trashed content in that box.

---

## Implementation files

| File | Purpose |
|---|---|
| `src/lib/supabase/admin.ts` | Admin Supabase client factory (service role) |
| `src/server/domain/types/connection.ts` | `Connection`, `ConnectionToken`, `ConnectionBoxScope` domain types |
| `src/server/domain/constants/connection_constants.ts` | `CONNECTION_TYPE`, `CONNECTION_STATUS`, `PERMISSION_MODE`, `TOKEN_STATUS` |
| `src/server/repositories/connection_repository.ts` | DB CRUD for all three tables |
| `src/server/services/connection_service.ts` | `createConnection`, `rotateConnectionToken`, `revokeConnection`, `updateConnectionMeta`, `listConnectionsWithScopes` |
| `src/server/auth/get_connection_context.ts` | Bearer token parsing, verification, and `ConnectionRequestContext` resolution |
| `src/lib/api/response.ts` | `apiOk`, `apiError`, and convenience error constructors |
| `src/app/app/settings/connections_actions.ts` | Server actions for connection management UI |
| `src/components/product/connections_panel.tsx` | Connection management UI (create, list, rotate, revoke) |

## Status (v1.1): legacy vs OAuth

The bearer-token connections described in this doc remain functional
on `/api/v1/**` and are the auth mechanism for the stdio MCP server.
They are now **legacy** for connector-style integrations.

New third-party connectors (Claude Desktop, OpenAI Apps, custom
integrations) should authenticate via OAuth 2.1 + PKCE against the
endpoints documented in
[`docs/mcp_oauth_and_secure_connector_architecture_v1.md`](mcp_oauth_and_secure_connector_architecture_v1.md).
That path:

- replaces pasted bearer secrets with a user-driven consent flow;
- issues short-lived access tokens (1 hour) with rotating refresh
  tokens (30 days);
- binds access to a specific `(user, workspace)` rather than a
  workspace-wide connection;
- gates every call by both OAuth scope and workspace role.

Connection tokens will not be removed in this release. Operators can
continue using them; the Settings → Connections panel keeps them
visible and manageable. A future release may retire them once all
first-party surfaces have migrated.

## OAuth connector surfaces (2026-04-13)

Connections (`csk_v1_`) are now explicitly legacy for connector auth. New connector integrations should use OAuth clients via Settings → Developer apps or `POST /api/oauth/register`, then authorize through `/oauth/authorize` and exchange at `/api/oauth/token`.

### Legacy policy clarification (2026-04-13)

`csk_v1_` tokens are migration/dev artifacts and are not accepted by `/api/mcp`. New connector integrations must use OAuth discovery + authorization code with PKCE.
