# MCP OAuth product surface and token lifecycle (V1 completion)

Date: 2026-04-13

## What is now productized

- Real authorize + consent page at `/oauth/authorize`.
- Token exchange + refresh at `/api/oauth/token`.
- Revocation at `/api/oauth/revoke`.
- Dynamic client registration at `/api/oauth/register`.
- User grant management in Settings → Connected apps.
- OAuth client management in Settings → Developer apps.

## Authorization flow

1. Connector discovers metadata via `/.well-known/oauth-authorization-server`.
2. Connector redirects user to `/oauth/authorize` with PKCE (`S256`).
3. Consent page shows app identity, requested scopes, workspace selection, and box narrowing.
4. Approve writes consent + authorization code; deny returns `access_denied` redirect.
5. Connector exchanges code at `/api/oauth/token`.

## Token lifecycle model

- Access token lifetime: **1 hour** (`cso_a_...`).
- Refresh token lifetime: **30 days** (`cso_r_...`).
- Refresh rotates both tokens; replayed/retired refresh tokens trigger family revocation.
- Consent revocation invalidates all child access + refresh tokens for that grant.
- Audit events include issuance, refresh, and revocation.

## Client registration and management model

- Human or already-authenticated OAuth caller can register clients.
- Registration validates redirect URIs and scope vocabulary.
- Confidential client secrets are shown once; only hashes are stored.
- Developer settings UI supports registration, inspect metadata, rotate secret, and delete (with token revocation).

## Unified auth resolution

- `/api/mcp` and `/api/v1/**` both use unified bearer resolution semantics.
- OAuth paths enforce live workspace membership and role checks.
- Viewer-role OAuth calls are forced read-only to prevent write escalation.

## Branch behavior for OAuth-backed writes

OAuth-backed writes continue to use the canonical API write path and current default branch behavior. OAuth tokens currently do not independently specify branch targets; documentation and consent wording must not imply branch selection.

## Practical abuse controls

- `/api/oauth/token` rate-limited per `client_id + IP`.
- `/api/oauth/register` rate-limited per `user + IP`.
- `/oauth/authorize` approval action rate-limited per user.

## Out of scope (intentional)

- No token-in-URL patterns.
- No client-credentials grant.
- No opaque bypass around canonical role/membership gates.

## Connector compatibility checks

- Discovery documents and endpoint URLs are generated from one public base URL resolver.
- `/api/mcp` requires OAuth bearer access tokens and rejects legacy `csk_v1_` tokens.
- OAuth failures are logged in structured form without logging raw token secrets.

## Final write policy closure (2026-04-13)

- OAuth-backed writes are **main-only** in V1.
- Any attempted branch-targeting fields on OAuth write requests are rejected explicitly with a bad-request error.
- This keeps audit, rollback, and existing branch protection semantics honest while avoiding implicit branch behavior.

## End-to-end verification status

Route-level tests now cover discovery coherence, authorize approve/deny redirects, token exchange success/failure (bad verifier, bad redirect), refresh success/failure, legacy rejection on `/api/mcp`, insufficient scope denial, viewer write denial, and explicit OAuth branch-target rejection.
