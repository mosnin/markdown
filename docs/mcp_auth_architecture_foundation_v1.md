# MCP auth architecture — secure foundation v1

This document is the secure-foundation consolidation of Context
Store's MCP (Model Context Protocol) auth surface. It sits alongside
the existing `mcp_oauth_and_secure_connector_architecture_v1.md`
which covers the broader OAuth server design; this doc focuses on
what changed in this iteration and why.

Reading order:

1. `docs/auth_and_permissions.md` — role / scope / permission_mode
   vocabulary.
2. `docs/mcp_v1.md` — current MCP surface for integrators.
3. `docs/mcp_oauth_and_secure_connector_architecture_v1.md` — full
   OAuth server architecture.
4. **This doc** — secure-foundation hardening; deprecation of the
   legacy `csk_v1_` flow; adapter consolidation.

## What was insecure

Before this iteration, any integrator connecting an AI client to
Context Store had to:

1. Generate a long-lived `csk_v1_` token via Settings → Connections.
2. Paste it into an environment variable
   (`CONTEXT_STORE_CONNECTION_SECRET`) on the machine running the
   stdio MCP server.
3. Start the MCP server by hand.

That model has concrete problems:

| Problem | Impact |
| --- | --- |
| Long-lived workspace-wide secret in `env` | Compromise scope is every box the connection was granted; blast radius on leak is large. |
| Token pasted through clipboards / shell history / config files | Many incidental exposure paths. |
| No consent screen | Users can't see what scopes they're granting. |
| No connector-compatible transport | Claude Desktop, OpenAI Apps, and other remote MCP clients expect HTTP + OAuth; stdio + env isn't usable. |
| No revocation UX | "Log out this integration" meant regenerating the token and redeploying. |
| Weak audit attribution | `actor_type='connection'`, not the human. |

## New MCP base URL model

The canonical public MCP endpoint is:

```
POST ${NEXT_PUBLIC_APP_URL}/api/mcp
Authorization: Bearer <OAuth 2.1 access token>
Content-Type: application/json
```

Discovery is dual-published so every off-the-shelf connector can
bootstrap:

* **RFC 8414 authorization-server metadata** at
  `/.well-known/oauth-authorization-server` — lists
  `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`,
  `registration_endpoint`, `scopes_supported`,
  `grant_types_supported`, `response_types_supported`, and
  `code_challenge_methods_supported: ["S256"]`.
* **MCP server metadata** at `/.well-known/mcp-server` — lists the
  `mcp_server_url`, the transport, the supported scopes, and a
  pointer to the authorization-server metadata.

Both endpoints are open GETs, cache for an hour, and resolve their
issuer from `NEXT_PUBLIC_CANONICAL_URL` → `NEXT_PUBLIC_APP_URL` →
`NEXT_PUBLIC_SITE_URL` → `http://localhost:3000` in that order so
deployments behind proxies produce correct URLs.

## Client identity model

Three identity shapes exist. Only the first two are supported going
forward:

1. **First-party OAuth client** — shipped with the deployment,
   `is_first_party=true`, may be confidential. Example:
   `context-store-connector`.
2. **Third-party OAuth client** — registered via
   `POST /api/oauth/register` by any signed-in Context Store user.
   May be public (PKCE-only) or confidential (PKCE + client_secret).
   `redirect_uris[]` are stored exact-match; wildcards are rejected.
3. **Legacy `csk_v1_` connection** (DEPRECATED) — workspace-scoped
   long-lived token. Gated behind
   `CONTEXT_STORE_LEGACY_CSK_ENABLED=true`. Emits a rate-limited
   `mcp.legacy_token_used` audit event on every use and attaches
   `Deprecation`, `Link`, and `Warning` headers to the response.

Confidential clients MUST have a `client_secret_hash`; public
clients MUST use PKCE. These invariants are enforced at the service
layer (`oauth_client_service`) and at the token endpoint.

## Scope model

Scopes are additive capabilities, NOT role upgrades. Role gates run
first; scope gates narrow within role.

| Scope | minRole | What it grants |
| --- | --- | --- |
| `context:read` | viewer | Read boxes / folders / notes / files / skills / agents. |
| `context:search` | viewer | Cross-type search. |
| `context:bundles` | viewer | Assemble deterministic context bundles. |
| `context:propose` | member | Submit write proposals for human review. |
| `context:generate` | member | Write into folders that are explicitly marked `accepts_generated_notes`. Reusable skills and agents are still proposal-only. |

There is explicitly NO `context:*` or `context:full` wildcard.

Box-narrowing scopes (`context:box:<uuid>`) optionally intersect the
accessible box set with a specific allowlist. A token with no box
scope gets workspace-wide access to whatever capabilities its
capability scopes grant.

## Auth flow shape

```
Connector (Claude / OpenAI / CLI)
    │
    │  1. GET /.well-known/oauth-authorization-server
    │     GET /.well-known/mcp-server
    │
    │  2. Redirect user →
    │     /oauth/authorize?response_type=code&client_id=<>
    │       &redirect_uri=<>&scope=<>&state=<>&code_challenge=<S256>
    │
    ▼
Context Store /oauth/authorize (page.tsx)
    │  Requires signed-in user session.
    │  Renders consent UI (workspace picker, scope list).
    │  approveAuthorizeAction writes oauth_consents + oauth_authorization_codes
    │  Redirects to redirect_uri with ?code=...&state=...
    │
    ▼
Connector POST /api/oauth/token
    │  grant_type=authorization_code + code + code_verifier
    │  Returns { access_token: "cso_a_…" (1h),
    │            refresh_token: "cso_r_…" (30d),
    │            expires_in: 3600, scope: "…" }
    │
    ▼
Connector POST /api/mcp
    │  Authorization: Bearer cso_a_…
    │  JSON-RPC 2.0 body
    │  resolveMcpRequestAuth → McpAuthContext:
    │    { source: 'oauth', userId, workspaceId, role, scopes,
    │      allowedBoxIds, clientId, connectionId, permissionMode }
    │  Tool dispatch:
    │    - requireScope(ctx, tool.scope)  → 403 without scope
    │    - requireWrite(ctx)              → 403 for viewer
    │    - canAccessBox(ctx.scopes, id)   → per-tool box gate
    │  auditMcp → actor_type='user', metadata.oauth_client_id
    │
    ▼
Refresh: POST /api/oauth/token grant_type=refresh_token
    │  Rotates access + refresh; replay of old refresh
    │  revokes the whole family_id.
    ▼
Revoke:  POST /api/oauth/revoke (RFC 7009)
    │  Or: admin → oauth_consents.revoked_at → resolver short-circuits.
```

## What's implemented in this iteration

Schema

* `supabase/migrations/20260413000006_mcp_auth_hardening.sql`
  - `oauth_access_tokens.last_audit_event_id`
  - `oauth_refresh_tokens.last_audit_event_id`
  - `oauth_clients.deprecated_at`
  - `connections.deprecated_at`
  - `connection_tokens.last_warned_at`
  - Index hygiene on the above.

Auth adapter

* `src/server/auth/mcp_auth_adapter.ts` — single entry
  `resolveMcpRequestAuth(request)` that returns a unified
  `McpAuthContext` for OAuth OR legacy csk_v1_.
* OAuth path uses `oauth_token_service.resolveAccessToken` and
  honours the live `oauth_consents.revoked_at` check.
* Legacy path is gated by `CONTEXT_STORE_LEGACY_CSK_ENABLED=true`.
  Emits `mcp.legacy_token_used` audit event, rate-limited per-token
  to 1/hour via `connection_tokens.last_warned_at`.
* `legacyDeprecationHeaders()` returns the `Deprecation` + `Link` +
  `Warning` headers that route handlers attach to deprecated
  responses.
* `requireScope(ctx, cap)` and `requireWrite(ctx)` guards for the
  route layer.

Service layer

* `oauth_client_service.ts`: `deprecateClient`, `updateClient`,
  `listClientsForOwner`. Confidential-clients-require-secret
  invariant asserted.
* `oauth_token_service.ts`: `revokeAllTokensForConsent(consentId)`
  — revokes every live token in a consent AND stamps the consent
  `revoked_at` so future resolutions short-circuit.
* `audit_service.ts`: `auditMcp(event)` — canonical writer for
  MCP-routed events. `actor_type='user'`, `actor_id=userId`,
  `metadata.oauth_client_id`, `metadata.connection_id`,
  `metadata.auth_source`.

Stdio deprecation

* `src/server/mcp/index.ts`: JSDoc marked `@deprecated`; startup
  prints a migration warning and refuses to start in production
  (`NODE_ENV=production`) without
  `CONTEXT_STORE_LEGACY_CSK_ENABLED=true`.

Discovery

* `src/app/.well-known/mcp-server/route.ts` — MCP server
  discovery metadata (url, transport, scopes, auth server pointer).
* `src/app/.well-known/oauth-authorization-server/route.ts` — no
  drift; verified.

HTTP MCP endpoint

* `src/app/api/mcp/route.ts` — unchanged behaviour; now calls
  `auditMcp` so attribution shape is uniform.

Tests

* `src/tests/unit/oauth_scope_service.test.ts` — 18 cases covering
  capability / box-scope parsing, access checks, role gating,
  scope-request resolution, and registry invariants ("no wildcard
  scope" asserted).
* `src/tests/unit/mcp_auth_adapter.test.ts` — 20 cases covering
  env-flag gating, deprecation header shape, scope/role guards over
  OAuth and legacy contexts, and context shape invariants.

Baseline was 393 tests. Post-change: 434 tests passing (+41 new,
0 regressions).

## What's explicitly deferred

These items are listed in the follow-up plan and will land in
subsequent PRs:

* **Admin UI at `/admin/oauth_clients`** — server-side helpers
  exist (`listClientsForOwner`, `deprecateClient`, `updateClient`);
  the UI seam is not yet built. Registration is still reachable via
  the `/api/oauth/register` endpoint.
* **Rewiring every `/api/v1/**` route through
  `resolveMcpRequestAuth`** — currently only the MCP route is
  updated. The canonical API still accepts OAuth via the existing
  `getConnectionContext` dispatcher at
  `src/server/auth/get_connection_context.ts:87`, which covers the
  OAuth path; deprecation hooks there are not wired.
* **Branch-targeted writes for OAuth-backed machine flows** —
  deliberately out of scope; OAuth writes default to main.
* **Auto-linkage of `last_audit_event_id` on token issue** — the
  schema column is in place; the resolver does not yet persist the
  event id it emitted.

## Remaining limitations

* `connection_tokens.last_warned_at` uses "last 1h" semantics; a
  rapidly-restarting process can race and emit two events close
  together. Acceptable because the events are idempotent from a
  compliance perspective.
* `auditMcp` writes `actor_type='user'` for legacy csk_v1_ when a
  user id is present; when `userId` is null (current legacy case)
  callers MUST fall back to the existing connection-actor audit
  writers. `auditMcp` does not auto-demote to connection-attribution
  because that would silently drop the channel metadata.
* Dynamic client registration (`/api/oauth/register`) accepts any
  signed-in Context Store user. Per-workspace registration limits
  are a follow-up.

## 2026-04-13 completion notes

- Canonical `/api/v1/**` bearer resolution now delegates to the same unified adapter used by `/api/mcp`, so OAuth and legacy `csk_v1_` paths share one verifier and one role/membership re-check flow.
- OAuth token rate limits now apply on `/api/oauth/token` (per `client_id + IP`) and `/api/oauth/register` (per `user + IP`), with `slow_down` responses and retry guidance.
- Consent approvals are now rate-limited per signed-in user to reduce authorize-surface abuse.
- Token lifecycle audit now includes refresh and revocation events in addition to initial token issuance.
