# MCP connector compatibility and launch readiness (V1)

Date: 2026-04-13

## Discovery and endpoint contract

- OAuth AS metadata: `GET /.well-known/oauth-authorization-server`
- MCP server metadata: `GET /.well-known/mcp-server`
- Protected resource metadata: `GET /api/mcp`
- Authorization endpoint: `GET /oauth/authorize`
- Token endpoint: `POST /api/oauth/token`
- Revocation endpoint: `POST /api/oauth/revoke`
- Registration endpoint: `POST /api/oauth/register`

All endpoint URLs are generated from the same public app base URL resolver (`NEXT_PUBLIC_APP_URL` preferred), so connectors receive coherent URLs across discovery documents.

## End-to-end auth behavior

1. Connector discovers OAuth + MCP metadata.
2. User is redirected to `/oauth/authorize` with authorization code + PKCE (`S256`).
3. User approves or denies consent.
4. Connector exchanges code at `/api/oauth/token`.
5. Connector calls `/api/mcp` with `Authorization: Bearer cso_a_...`.
6. Connector refreshes via `/api/oauth/token` with `grant_type=refresh_token`.
7. Revocation via `/api/oauth/revoke` or user-facing grant revocation in Settings.

## Legacy policy

- Legacy `csk_v1_` tokens are **not accepted on `/api/mcp`**.
- Legacy path is isolated to migration/dev surfaces behind `CONTEXT_STORE_LEGACY_CSK_ENABLED=true`.
- Product-facing connector setup and docs point to OAuth only.

## Branch behavior

OAuth-backed writes follow canonical API branch semantics (default behavior) and do not independently select a branch target.

## Troubleshooting

- `401` on `/api/mcp`: verify bearer token is `cso_a_...` (legacy tokens are rejected).
- `invalid_client` on token exchange: verify `client_id` and client secret auth method.
- `invalid_grant` on token exchange: verify redirect URI exact match and PKCE verifier.
- `access_denied` on authorize callback: user denied consent or user lacks selected workspace access.
- Unexpected missing tools: token scopes do not include required capability.

## Final policy closure

- OAuth write requests are explicitly main-only and reject branch-targeting attempts.
- Full repository `pnpm -s tsc --noEmit` is expected to pass in this repository state.
