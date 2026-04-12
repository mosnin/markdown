# MCP OAuth and secure connector architecture — v1

Context Store's MCP (Model Context Protocol) surface is the seam where
external AI tools touch workspace content. It must be safe for humans
and for the third-party connectors — Claude Desktop, OpenAI apps,
custom agents — that will speak to it on their behalf. This document
is the architecture of how that happens.

## Why this exists

Before this change the only way to give an AI client access was:

1. Generate a long-lived bearer token via Settings → Connections.
2. Paste the token into an env var (`CONTEXT_STORE_CONNECTION_SECRET`)
   on the machine running the stdio MCP server.
3. Start the MCP process by hand.

That model has three real problems:

1. **No connector-style flow.** Claude Desktop / OpenAI Apps expect to
   walk the user through an OAuth authorize screen and obtain their
   own tokens. Our setup requires manual env-var plumbing.
2. **Long-lived secret in plaintext.** Tokens have a 90-day default
   TTL and sit in env vars, shell history, config files. Compromise
   scope is large.
3. **Identity is workspace-wide, not user-specific.** The token is
   issued against a workspace "connection" that every agent sharing
   the machine uses. Audit attribution is weaker than it should be.

The fix is a standard OAuth 2.1 + PKCE server on top of the existing
Supabase-auth human session, a proper HTTP MCP transport that accepts
short-lived bearer tokens, and a scope model that maps to the product's
existing permission primitives.

## Architecture at a glance

```
Connector (Claude / OpenAI / CLI)
  │
  │  1. GET /.well-known/oauth-authorization-server  ──────────── metadata
  │
  │  2. Redirect user to /oauth/authorize?response_type=code
  │     &client_id&redirect_uri&scope&state&code_challenge
  │
  ▼
Context Store /oauth/authorize (Next.js page)
  │  Requires logged-in user session
  │  Renders consent UI; user picks workspace, approves
  │
  ▼
approveAuthorizeAction (server action)
  │  Writes oauth_consents row
  │  Writes oauth_authorization_codes row (10 min TTL, PKCE bound)
  │  Redirects to redirect_uri with ?code=...&state=...
  │
  ▼
Connector POST /api/oauth/token
  │  grant_type=authorization_code + code + code_verifier
  │  Returns access_token (1h) + refresh_token (30d)
  │
  ▼
Connector POST /api/mcp
  │  Authorization: Bearer cso_a_...
  │  JSON-RPC 2.0 body (MCP protocol)
  │  Server resolves token → user → workspace → role → scope
  │  Dispatches tool; checks scope; writes audit
```

## Database schema

Migration `supabase/migrations/20260412000006_oauth_server.sql`.

* **`oauth_clients`** — connector registrations. `client_id`,
  optional `client_secret_hash` (confidential only), exact-match
  `redirect_uris[]`, `allowed_scopes[]`, `is_confidential`,
  `is_first_party`, `status`. Secrets are SHA-256 hashed and shown
  once. A default first-party client `context-store-connector` is
  seeded for self-hosted deployments.

* **`oauth_authorization_codes`** — single-use codes. Stored as
  SHA-256 hashes, 10-minute TTL, PKCE `code_challenge` + `S256`
  captured at issue. Token endpoint verifies with constant-time
  compare and marks `used_at` in a CAS update.

* **`oauth_access_tokens`** — opaque 32-byte bearer tokens.
  `token_prefix` (8 chars, indexed) + `token_hash` (sha256,
  constant-time verified). Bound to `(client_id, user_id,
  workspace_id, scope)`. 1-hour default TTL. `revoked_at` for
  cooperative revocation.

* **`oauth_refresh_tokens`** — same shape as access tokens plus
  `family_id` (chain root) and `replaced_by_token_id` (rotation
  pointer). Every use rotates to a new access + refresh pair. Reuse
  of a revoked or already-used refresh token revokes the whole
  `family_id` — defense against token replay per RFC 6749 §10.4.

* **`oauth_consents`** — per `(user, client, workspace)` record of
  the user's Approve decision. Revoking a consent cascades to every
  live access + refresh token in one update and is checked on every
  token resolution.

All five tables have RLS. Clients are readable by any authenticated
user (so the consent page can render their name / logo). Tokens and
consents are readable only by the owning user. Writes happen through
the service-role admin client at specific endpoints.

## Endpoints

| Path                                        | Method | Purpose                                                |
|---------------------------------------------|--------|--------------------------------------------------------|
| `/.well-known/oauth-authorization-server`   | GET    | RFC 8414 discovery metadata                            |
| `/oauth/authorize`                          | GET    | User-facing consent page                               |
| `/oauth/authorize` (approveAuthorizeAction) | POST   | Approve → mint code, redirect                          |
| `/oauth/authorize` (denyAuthorizeAction)    | POST   | Deny → error redirect                                  |
| `/api/oauth/token`                          | POST   | `authorization_code` + `refresh_token` grants          |
| `/api/oauth/revoke`                         | POST   | RFC 7009 revocation                                    |
| `/api/mcp`                                  | GET    | RFC 9728 protected-resource metadata                   |
| `/api/mcp`                                  | POST   | MCP JSON-RPC 2.0 with Bearer OAuth                     |

## Client registration

**V1 scope: first-party seeding only.** The migration inserts a public
(PKCE-only) client called `context-store-connector` with standard
loopback + OOB redirect URIs. This is sufficient for:

* Claude Desktop registering the MCP URL against it.
* OpenAI Apps configuring a custom OAuth provider.
* CLI tooling using the OOB flow.

**Third-party self-service registration** is deliberately deferred.
`registerClient()` exists in `oauth_client_service.ts` and writes via
the admin client; a developer-portal UI would call it. Until that
ships, new third-party integrations are registered manually by
operators.

**Confidential vs public clients.** Public clients hold no secret and
must use PKCE (`S256` only). Confidential clients present
`client_secret_basic` or `client_secret_post` — secret is SHA-256
compared in constant time identical to connection tokens.

## Scopes

Defined in `src/server/services/oauth_scope_service.ts`. Every scope
declares a minimum workspace role required to grant it; the consent
page refuses to grant a scope the signed-in user's role cannot fulfil.

| Scope                 | Min role | What it allows                                               |
|-----------------------|----------|--------------------------------------------------------------|
| `context:read`        | viewer   | list boxes/folders, read notes/files/skills/agents           |
| `context:search`      | viewer   | full-text cross-type workspace search                        |
| `context:bundles`     | viewer   | fetch the deterministic context bundle around a note         |
| `context:propose`     | member   | submit write proposals (human review required)               |
| `context:generate`    | member   | write notes directly into folders flagged generated-allowed  |

No wildcard, no admin scope. Admin operations (membership management,
workspace settings) stay on the human UI with session auth. Scope
checks run on every MCP tool call and on every canonical-API write
that accepts an OAuth token.

## Token model

* **Opaque tokens**, not JWTs. Same pattern as connection_tokens —
  prefix lookup + constant-time hash compare. Revocation is a single
  UPDATE.
* **Access TTL = 1 hour**, **refresh TTL = 30 days**.
* **Refresh rotation** on every use. Replay of a used/revoked refresh
  token nukes the family.
* **Consent check on every access-token resolve** — revoking a
  consent invalidates every token underneath it in one update.

## MCP transport

The legacy stdio MCP server (`src/server/mcp/`) is preserved for
local development and for deployments that still want env-var-bound
access. It is **deprecated as the connector-facing path**.

The new HTTP transport at `/api/mcp` speaks JSON-RPC 2.0 and supports:

* `initialize` — protocol handshake
* `tools/list` — returns only the tools the token's scopes cover
* `tools/call` — dispatches to the service layer

Tool set exposed on HTTP in V1 (growable without further auth
changes): `list_boxes`, `get_note`, `search_workspace`,
`create_write_proposal`. The legacy stdio server continues to expose
its full set.

## Attribution and audit

Every grant, token issuance, revocation, and tool call writes an
audit event:

* `oauth.consent.approved` — user approved a connector for a workspace
* `oauth.consent.revoked` — user revoked a connector
* `oauth.token.issued` — token pair minted via authorization_code flow
* `mcp.tool.called.<tool>` — per-call attribution with scope + client

These land in the existing `audit_events` table alongside every other
workspace event, visible in the Audit Log page. Event types follow
the dot-taxonomy so the existing filter UIs pick them up without
changes.

Machine writes (proposals, generated notes) continue to flow through
the product's trust model:

* The actor on the resulting `write_proposals` row is the connection.
* The change_set for the proposal approval carries the OAuth client_id
  in metadata alongside the human approver.
* Rollback can undo an approved proposal as a single grouped operation
  (see `docs/rollback_architecture_v1.md`).

## Workspace membership binding

The token is bound to `(user, workspace)` at issue. On every request:

1. The OAuth resolver looks up the token.
2. It re-fetches `getWorkspaceRole(workspaceId, userId)` to pick up
   any role downgrades since token issue.
3. If the user is no longer a member of the workspace, the MCP call
   fails with 403 and a WWW-Authenticate hint.
4. Scope gating runs alongside role gating — a token with
   `context:generate` can still not write if the user's role is
   `viewer`.

This means consent does not outlive the underlying permission.
Removing a user from a workspace immediately disables every connector
they approved for it.

## Legacy migration

The pre-existing `connections` + `connection_tokens` system is kept,
marked deprecated, and continues to work for the canonical `/api/v1`
endpoints. Docs and the Settings UI now promote the OAuth flow as the
recommended path:

* `docs/connections_v1.md` — notes that bearer connection tokens are
  legacy; new integrations should use OAuth.
* `docs/mcp_v1.md` — describes both transports with the HTTP /
  OAuth one framed as primary.
* Settings → Connected apps is a new panel that lists OAuth grants
  and lets users revoke them; the legacy Connections panel remains
  for existing integrations.

There is no forced migration deadline in V1. Existing deployments
using the stdio + env-var flow keep working; new connector-style
integrations land on OAuth.

## Follow-ups landed (v1.1)

The V1 deferrals below were the next tranche of work. Each is now live
and covered by the architecture.

### Feature-parity HTTP MCP tool set

The HTTP `/api/mcp` transport now exposes every read + write tool the
legacy stdio server offered, adapted to OAuth identity:

| Tool                    | Scope                | Notes                                              |
|-------------------------|----------------------|----------------------------------------------------|
| `list_boxes`            | `context:read`       | unchanged                                          |
| `get_box_overview`      | `context:read`       | proxies `overview_service.getBoxOverview`          |
| `list_folder_contents`  | `context:read`       | folder + note list scoped to `(box, parent)`       |
| `get_note`              | `context:read`       | unchanged                                          |
| `get_linked_notes`      | `context:read`       | inbound + outbound via `note_link_repository`      |
| `search_workspace`      | `context:search`     | cross-type search                                  |
| `get_context_bundle`    | `context:bundles`    | `context_bundle_service.assembleContextBundle`     |
| `create_write_proposal` | `context:propose`    | human-review queue                                 |
| `create_generated_note` | `context:generate`   | folder must have `accepts_generated_notes = true`  |

`create_generated_note` synthesizes a minimal `ConnectionRequestContext`
from the OAuth identity so the existing `generated_note_service` runs
unchanged — the folder-policy check still fires and reusable
skills/agents still require proposals.

### Unified identity resolver on `/api/v1/**`

`src/server/auth/get_connection_context.ts` now dispatches on token
prefix:

- `csk_v1_<hex>` → legacy connection_token path (unchanged).
- `cso_a_<base64url>` → OAuth access token. A synthetic
  `Connection` is built from `(oauth_client, scope)` so every existing
  `/api/v1/**` handler accepts OAuth tokens without modification.
  Permission_mode is derived from scope: `context:generate` →
  `generate_in_allowed_folders`, `context:propose` →
  `propose_writes`, otherwise `read_only`. `allowedBoxIds` is every
  live box in the workspace, matching membership semantics.

### Dynamic Client Registration (RFC 7591)

- New endpoint: `POST /api/oauth/register`.
- Requires an authenticated Context Store identity (session cookie or
  existing OAuth access token) — no anonymous drive-by registration.
- Request body follows RFC 7591 §2 (`client_name`, `redirect_uris`,
  `scope`, `client_uri`, `logo_uri`, `token_endpoint_auth_method`).
- Unknown scopes are silently dropped per RFC 7591 §3.2.1.
- Response follows RFC 7591 §3.2 with `client_secret_expires_at = 0`
  for confidential clients (we don't rotate secrets; clients delete +
  re-register if needed).
- `registration_endpoint` is advertised in the discovery metadata at
  `/.well-known/oauth-authorization-server`.
- Every registration writes an `oauth.client.registered` audit event.

### Developer Apps UI

Settings → Developer apps exposes the same registration flow through
the product UI:

- List apps the user registered + first-party seeded apps (read-only).
- Register dialog with public vs confidential selector, scope
  checkboxes, redirect-URI textarea.
- Credentials dialog shows `client_id` and (for confidential clients)
  the one-time `client_secret` with a copy button and a clear warning
  that the secret is unrecoverable after close.
- Per-app delete button that revokes every live token for the client
  in one update before soft-deleting the row.

## Remaining limitations

- **Streamable HTTP transport (MCP spec)** is still not implemented.
  `/api/mcp` is request/response JSON-RPC, which every production
  connector we target currently accepts. Streamable HTTP adds value
  for long-running tools (incremental outputs) which Context Store
  tools don't have today. Deferred with no user-visible impact.
- **Confidential-client secret rotation** is not exposed. Current
  workflow: delete the client (revokes all tokens) and register a
  new one. A rotate-secret endpoint is a future-friendly addition.
- **OAuth authorize CSRF**: we rely on the OAuth `state` parameter
  (which the connector generates + verifies) plus Supabase session
  cookie auth and exact-match redirect URIs. A double-submit CSRF
  token on the approve action would be belt-and-suspenders; standard
  OAuth doesn't require it.
- **Per-box scope grants** for OAuth tokens. V1 OAuth tokens are
  workspace-wide; legacy `connection_tokens` still support per-box
  scoping. A `context:read:box:<id>` scope family is the natural
  extension and doesn't require a migration.
