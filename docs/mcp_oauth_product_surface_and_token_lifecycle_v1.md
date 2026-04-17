# MCP OAuth product surface and token lifecycle — v1

This doc covers the productization pass that turned the OAuth 2.1
foundation (landed in commit `2eefda4`) into a real, connector-facing
product surface. For the foundation itself see
[mcp_auth_architecture_foundation_v1.md](mcp_auth_architecture_foundation_v1.md).

## Summary

The foundation delivered the primitives — schema, endpoints, services,
unified auth resolver, scope model. The productization pass added the
real authorize page, the client-management UI, the user grant-management
UI, rewired every `/api/v1/**` route through the unified resolver,
added rate limits, completed audit attribution, and made OAuth-backed
branch writes explicitly rejected.

Net effect: Context Store now has a connector-ready OAuth surface that a
third-party MCP client (Claude, ChatGPT, a custom agent) can integrate
against without any token-in-env workarounds.

## What was missing before this pass

- The `/oauth/authorize` page existed but was stub-grade. No real app
  identity card, no scope descriptions, no write-capability warning.
- No UI for registering or managing OAuth clients. `/api/oauth/register`
  worked but users had to call it by hand.
- No UI for users to see which apps had access to their workspace or
  revoke those grants.
- `/api/v1/**` read and write routes still dispatched through the
  legacy `getConnectionContext` resolver instead of the unified
  `resolveMcpRequestAuth`, so scope-gate + role-gate application was
  inconsistent route-to-route.
- Dynamic client registration had no rate limit. Token and authorize
  endpoints had no abuse bucket.
- Audit attribution for OAuth token issuance, refresh, revocation, and
  consent grant/revoke was incomplete.
- OAuth-backed writes defaulted to main silently. A client passing a
  `branch_id` in a write body would have had undefined behavior.

## Authorize page UX

Route: `src/app/oauth/authorize/page.tsx`.

Flow:

1. **Unauthenticated**: 302 to `/sign_in?next=<encoded authorize URL>`
   preserving every query param.
2. **Malformed request** (unknown `client_id`, `redirect_uri` not in
   `client.redirect_uris`, missing required field): inline error page
   with a "Go home" button. Never redirect back to the client — per
   OAuth 2.1 security guidance.
3. **Protocol error against a valid client+redirect** (missing PKCE
   `code_challenge_method=S256`, missing `state`, unknown
   `response_type`, requested scope not in `client.allowed_scopes`):
   302 back to the client with `?error=...&error_description=...&state=...`
   per spec.
4. **First-party client with existing covering consent**: auto-approve.
   Code is minted and 302 back to the client. Audit event
   `oauth.consent.auto_approved` is emitted.
5. **Otherwise**: render the production consent card.

Consent card contents:

- App identity: client name, logo if set, homepage link, verified badge
  (`is_first_party=true`) or third-party badge.
- Workspace card: active workspace name + slug, role badge. If the user
  has multiple workspaces, a "switch workspace" link routes via
  `/app/workspaces` with a `returnTo` back to the same authorize URL.
- Scope list grouped as **Read** (green), **Propose writes** (amber),
  **Generate** (red). Each scope shows plain-English title and
  description from `src/lib/oauth_scope_descriptions.ts`.
- Write-warning banner if any requested scope has write capability.
- Box-narrowing scopes (`context:box:<uuid>`) resolve to real box names
  and render as info badges.
- Legal footer: "1-hour access token + 30-day rotated refresh token;
  revoke any time in Settings → Connected apps."
- Two buttons: **Authorize** (primary) and **Deny** (secondary).

Denial: 302 to `redirect_uri?error=access_denied&state=<state>`.

Approval: 302 to `redirect_uri?code=<code>&state=<state>`. The code is
a `cso_c_` authorization code with 10-minute TTL, PKCE-bound, single-use.

## Token lifecycle

| Token | Prefix | Lifetime | Notes |
|---|---|---|---|
| Authorization code | `cso_c_` | 10 minutes | Single-use, PKCE S256 bound |
| Access token | `cso_a_` | 1 hour | Bearer, narrow scope |
| Refresh token | `cso_r_` | 30 days | Rotated on every use |

### Rotation

Refresh rotation is atomic:
- Old refresh marked `used_at=now()`.
- New access + new refresh issued with the same `family_id`.
- Response returns both.

Replay detection: if a refresh token is used and `used_at` is already
set, the entire `family_id` is revoked (chain-wide invalidation). This
catches stolen-refresh scenarios where the attacker reuses a token the
legitimate client already rotated.

### Consent-revoke cascade

`resolveAccessToken` checks `oauth_consents.revoked_at IS NULL` on every
resolve. Revoking a consent immediately invalidates every child access
and refresh token — no wait for expiry. `revokeAllTokensForConsent()`
additionally stamps `revoked_at` on each child token row for defense in
depth.

### Expired-token response shape

Every `/api/v1/**` route returns:

```
HTTP 401
WWW-Authenticate: Bearer realm="context-store", error="invalid_token"
Content-Type: application/json

{ "error": "invalid_token", "error_description": "Access token expired" }
```

For scope failure:

```
HTTP 401
WWW-Authenticate: Bearer realm="context-store", error="insufficient_scope", scope="<required>"

{ "error": "insufficient_scope" }
```

For role failure:

```
HTTP 403
{ "error": "forbidden", "error_description": "Write access requires member or higher role" }
```

## Client management

Route: `/app/settings/oauth_clients`.

**Ownership model**: strict per-user. A user sees only clients they
registered (`created_by = caller`). First-party platform-seeded clients
are excluded from this list; they're managed by platform admins.

**Registration form**: name, description, homepage URL, redirect URIs
(exact-match list), allowed scopes (checkboxes with plain-English
titles), confidential/public radio.

**Secret-shown-once**: on successful registration, `client_id` always
displays. If confidential, `client_secret` displays **once** with a
copy-to-clipboard button and a prominent "This is the only time you
will see this secret" warning. Refreshing the page does not re-show it.
The hash (`client_secret_hash`, SHA-256) is what's stored.

**Edit**: name, description, homepage URL, redirect URIs, allowed
scopes. Does not rotate secret (that's a separate action).

**Rotate secret**: confidential clients only. Old hash replaced, new
secret shown once. Does NOT revoke existing tokens — consent and tokens
are independent of the secret.

**Deprecate**: sets `oauth_clients.deprecated_at`. The client can still
exchange existing refresh tokens but cannot start new authorize flows.
Deprecation is reversible (edit clears `deprecated_at`).

**Deprecation ≠ revocation**: deprecation blocks new grants.
Revocation (done per-grant via the Connected Apps UI, not per-client)
invalidates existing tokens. A client with an active grant remains
usable after deprecation until the grant is revoked or the refresh
token expires.

## Grant management

Route: `/app/settings/connected_apps`.

Two sections:
- **Active grants** — every consent where `user_id=caller AND revoked_at IS NULL`.
- **Revoked** — historical grants, dimmed, kept for audit visibility.

Per-row: client logo, name, first-party/third-party badge, homepage
link, client description, workspace name, granted date, last used at
(max across child access tokens), active session count, granted scope
chips with semantic colors.

**Scope detail** expandable section shows each granted scope with its
full plain-English description. Box-narrowing scopes render as a
separate "Access is limited to these boxes" block.

**Revoke**: confirmation modal shows workspace name and token count to
be invalidated. Action calls `revokeAllTokensForConsent(consentId)`.
Toast shows "Access revoked. N token(s) invalidated." Ownership check
enforced server-side (`consent.user_id === caller`).

## `/api/v1/**` unification

All 16 canonical API routes now dispatch through `resolveMcpRequestAuth`
and apply consistent scope + role + box-narrowing guards:

| Route | Scope | Write? | Branch guard? |
|---|---|---|---|
| `GET /api/v1/boxes` | `context:read` | — | — |
| `GET /api/v1/boxes/[box_id]/box_guide` | `context:read` | — | — |
| `GET /api/v1/boxes/[box_id]/box_overview` | `context:read` | — | — |
| `GET /api/v1/boxes/[box_id]/folder_contents` | `context:read` | — | — |
| `GET /api/v1/notes/[note_id]` | `context:read` | — | — |
| `GET /api/v1/notes/[note_id]/linked_notes` | `context:read` | — | — |
| `GET /api/v1/notes/[note_id]/versions` | `context:read` | — | — |
| `POST /api/v1/search_notes` | `context:search` | — | — |
| `POST /api/v1/context_bundles` | `context:bundles` | — | — |
| `GET /api/v1/export_note` | `context:read` | — | — |
| `GET /api/v1/export_folder` | `context:read` | — | — |
| `GET /api/v1/export_box` | `context:read` | — | — |
| `GET /api/v1/export_context_bundle` | `context:bundles` | — | — |
| `GET /api/v1/system_guide` | `context:read` | — | — |
| `POST /api/v1/write_proposals` | `context:propose` | ✓ | ✓ |
| `POST /api/v1/generated_notes` | `context:generate` | ✓ | ✓ |

**MCP branch tools** (JSON-RPC via `POST /api/mcp`):

| Tool | Scope(s) | Write? |
|---|---|---|
| `create_branch` | `context:branch` | ✓ |
| `write_to_branch` | `context:branch` + `context:propose` | ✓ |
| `get_branch_diff` | `context:branch` + `context:read` | — |
| `list_branches` | `context:branch` | — |

Write routes additionally enforce `requireWrite(ctx)` (viewers
rejected) and `requireNoBranchTargeting(ctx, body.branch_id)` (400 if
OAuth-backed with a branch id, unless the caller has `context:branch`
scope and owns the target branch).

The pre-existing `apiWriteLimit(connectionId)` 20-writes-per-minute
limit is preserved. The reusable-Skill/Agent proposal-only barrier
(`connectionCanDirectlyWrite`) remains authoritative — it cannot be
bypassed regardless of scope.

`/api/v1/import_package` is intentionally not rewired — it remains a
human-session-only route.

## Rate limits

Fixed-window 1-minute buckets (`rate_limit_buckets` table). Exceed
returns 429 with `Retry-After` header and emits a `rate_limit.tripped`
audit event.

| Bucket key | Limit | Purpose |
|---|---|---|
| `oauth_register:user:<userId>` | 3 / hour | Stop infinite client registration |
| `oauth_token:client:<clientId>` | 30 / min | Stop token-endpoint hammering |
| `oauth_authorize:user:<userId>` | 10 / min | Stop consent-form brute force |
| `oauth_revoke:user:<userId>` | 30 / min | Stop revoke spam |
| `api_write:connection:<id>` | 20 / min | Pre-existing; preserved |

## Audit events

Each event has `actor_type='user'` and `actor_id=<user_id>`, with
relevant ids in `metadata`. No resolver-level per-request audit (too
noisy); audits fire on meaningful lifecycle transitions only.

| Event type | Emitted when | Key metadata |
|---|---|---|
| `oauth.client.registered` | Client created | `oauth_client_id`, `ip` |
| `oauth.client.updated` | Client patched | `oauth_client_id`, `patch` |
| `oauth.client.deprecated` | Client deprecated | `oauth_client_id` |
| `oauth.consent.granted` | User approves authorize | `oauth_client_id`, `workspace_id`, `scopes` |
| `oauth.consent.auto_approved` | First-party covering consent hit | Same as above |
| `oauth.consent.revoked` | User revokes grant | `oauth_client_id`, `workspace_id`, `cascaded_tokens` |
| `oauth.token.issued` | Authorization code exchanged | `oauth_client_id`, `token_id`, `grant_type='authorization_code'` |
| `oauth.token.refreshed` | Refresh token rotated | `new_token_id`, `rotated_from_token_id` |
| `oauth.token.revoked` | Explicit revoke or cascade | `token_id`, `reason` |
| `rate_limit.tripped` | Any bucket exceeded | `bucket_key`, `limit` |
| `mcp.write_proposal.created` | Proposal submitted via OAuth | `oauth_client_id`, `proposal_id` |
| `mcp.note.generated` | Note created via OAuth | `oauth_client_id`, `note_id`, `folder_id` |
| `bundle.read` | Context bundle read via OAuth | `oauth_client_id`, `box_id`, `linked_count`, `guide_included`, `ancestor_summary_included`, `truncated`, `include_user_branches`, `pending_branch_count` |

## Branch behavior for OAuth writes

**OAuth-backed MCP writes target main only.** Any request carrying a
branch id is rejected with 400.

Rationale: branch-aware machine writes are semantically incompatible
with the current consent model. A consent grants access to a workspace,
not to a specific branch. Branch-targeting over a machine grant would
also bypass the change-set recording that a human session performs
automatically via `ctx.activeBranchId`. Adding branch support for
OAuth is a future-work item and will require an explicit scope and
consent extension.

The guard:

```typescript
requireNoBranchTargeting(ctx, requestedBranchId)
```

lives on `src/server/auth/mcp_auth_adapter.ts`. Write routes call it
with whatever branch field their request body exposes. If the caller
is OAuth-sourced and the branch id is non-null, the guard throws
`BranchTargetingNotAllowedError` → 400.

Human sessions (via `getRequestContext()`) are unaffected — the human
`activeBranchId` cookie flow continues to route writes through the
branch overlay tables (`branch_heads`, `branch_pending_ops`,
`folder_branch_overrides`, `branch_placement_overrides`,
`branch_package_metadata`, `box_branch_metadata_overlay`,
`files.branch_id`, `notes.branch_id`, `folders.branch_id`,
`boxes.branch_id`, `object_links.branch_id`, `note_links.branch_id`,
`box_object_attachments.branch_id`).

## Out of scope

These are deliberate deferrals, not gaps:

- **Cross-workspace admin UI for OAuth clients.** A workspace admin
  today cannot see other users' clients registered under that
  workspace. Present design is strictly per-user to avoid cross-user
  credential surface area the schema doesn't RLS-enforce.
- **Dynamic client registration rate limit per IP.** Per-user 3/hour
  is the only registration bucket. An adversary with multiple
  accounts can bypass this.
- **Service-layer first-class `McpAuthContext`.** `createProposal` /
  `createGeneratedNote` still take the legacy `ConnectionRequestContext`
  shape; a transport-layer bridge (`toConnectionRequestContext`) adapts
  between the two. Safe but denser than ideal; follow-up refactor will
  thread `McpAuthContext` end-to-end.
- **OAuth-backed branch writes.** See "Branch behavior" above.
- **Invitation-based multi-user grants.** A grant is 1:1 to a user;
  there is no shared/team grant model.
- **Last-audit-event linkage.** `oauth_access_tokens.last_audit_event_id`
  column was added in migration `20260413000007` but is populated
  opportunistically by write paths, not by resolver. Read-only OAuth
  calls do not update it.

## Related docs

- [mcp_auth_architecture_foundation_v1.md](mcp_auth_architecture_foundation_v1.md)
- [mcp_v1.md](mcp_v1.md)
- [connections_v1.md](connections_v1.md)
- [auth_and_permissions.md](auth_and_permissions.md)
- [architecture.md](architecture.md)
