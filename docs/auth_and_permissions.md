# Auth and permissions

## Overview

Context Store is a single-tenant-per-workspace product with multi-user
workspaces. Every authenticated request carries:

1. A Supabase `auth.users` identity (verified by JWT).
2. An active workspace, selected via the `active_workspace_id` cookie
   and resolved by `getRequestContext()`.
3. A workspace role — one of `owner`, `admin`, `member`, `viewer` —
   attached to `RequestContext.workspace.role`.

The canonical seam is **`src/server/auth/get_request_context.ts`**. Every
server component, server action, and route handler must derive its
identity + workspace via `getRequestContext()` (or the strict variant
`requireAuthenticatedUser()`). Never call `supabase.auth.getUser()` or
read cookies directly in feature code — that duplication is exactly
what the request-context seam exists to prevent.

## Roles

| Role     | Reads workspace content | Creates/edits content | Manages members | Manages workspace settings |
|----------|:-----------------------:|:---------------------:|:---------------:|:--------------------------:|
| `viewer` | ✅                       | ❌                     | ❌               | ❌                          |
| `member` | ✅                       | ✅                     | ❌               | ❌                          |
| `admin`  | ✅                       | ✅                     | ✅               | ✅ (excluding ownership transfer) |
| `owner`  | ✅                       | ✅                     | ✅               | ✅                          |

`owner` is the canonical `workspaces.owner_id` and is always also an
`admin`-level member. The owner role cannot be downgraded through the
members UI; ownership transfer is an explicit separate operation (not in
V1).

## Data model

### `workspaces`

Unchanged from V1: one row per workspace, `owner_id` references
`auth.users`. Owner semantics are preserved.

### `workspace_memberships`

Introduced by migration `20260412000003_workspace_memberships.sql`.

| Column          | Type          | Notes                                      |
|-----------------|---------------|--------------------------------------------|
| `id`            | `uuid`        | PK                                         |
| `workspace_id`  | `uuid`        | FK → `workspaces.id`, ON DELETE CASCADE    |
| `user_id`       | `uuid`        | FK → `auth.users.id`, ON DELETE CASCADE    |
| `role`          | `text`        | CHECK IN `('viewer', 'member', 'admin')`   |
| `invited_by`    | `uuid`        | FK → `auth.users.id`, nullable             |
| `invited_at`    | `timestamptz` | Default now()                              |
| `accepted_at`   | `timestamptz` | Nullable — V1 direct-add sets it at insert |
| `created_at`    | `timestamptz` | Default now()                              |
| `updated_at`    | `timestamptz` | Default now()                              |
| unique          | `(workspace_id, user_id)`                                   |

The migration backfills an `admin` membership row for every existing
workspace owner so no legacy RLS check changes behaviour for them.

### Postgres helper functions

- `owns_workspace(wid uuid)` — redefined. Returns true iff the caller
  has *any* membership row on `wid`. Every child-table RLS policy that
  already referenced `owns_workspace` now naturally accepts members.
- `workspace_role(wid uuid)` — returns `'owner'` (owner_id match),
  `'admin' | 'member' | 'viewer'` (membership row), or NULL (no access).
- `can_write_workspace(wid)` — true for owner / admin / member.
- `can_admin_workspace(wid)` — true for owner / admin.

All four functions are `STABLE SECURITY DEFINER` with pinned
`search_path = public` so they can be called from inside child-table RLS
policies.

### RLS for `workspace_memberships`

- `SELECT own rows` — the authenticated user can always see their own
  membership rows.
- `SELECT admin rows` — admins see every membership row on workspaces
  they admin.
- `INSERT / UPDATE / DELETE` — admins only, keyed via
  `can_admin_workspace()`.

## Enforcement model

Reads are gated by RLS via the redefined `owns_workspace()`. Any member
role (viewer, member, admin) that has a row in `workspace_memberships`
can SELECT workspace-scoped rows.

Writes are gated in the **application layer**, not RLS. There are two
reasons:

1. The existing codebase has ~90 RLS policies keyed on
   `owns_workspace()`. Splitting each into SELECT / INSERT / UPDATE /
   DELETE variants with a new `can_write_workspace()` gate would be a
   massive, risky change for V1. A single service-layer seam is easier
   to audit and regress.
2. Every content mutation already funnels through a small number of
   server actions. Role enforcement lives in
   `src/server/auth/require_role.ts` (`requireWriteRole`,
   `requireWriteRoleResult`, `requireAdminRole`,
   `requireAdminRoleResult`) and in the `requireContext({ requireWrite
   })` helper used by the box / tree actions.

All write-path server actions must route through one of these guards.
Read-only actions opt out explicitly (`requireContext({ requireWrite:
false })`) so the intent is visible at every call site.

## Invitation flow (V1)

Direct-add only:

1. Admin enters an email in Settings → Members.
2. Server resolves the email to an existing `auth.users` row via the
   Supabase admin API.
3. If a user is found, the membership is inserted with
   `accepted_at = now()` and the role the admin chose.
4. If no user is found, the action returns an actionable error — the
   invitee must sign up first, then be re-added.

This deliberately avoids a pending-invitation table and an email send
step. The `accepted_at` column exists in the schema so a future V2 can
evolve to email-link invitations without a migration.

## Audit

Membership changes write to `audit_events` under these event types:

- `workspace.member.invited` — new membership row, metadata
  `{ invited_user_id, invited_email, role }`.
- `workspace.member.role_changed` — metadata
  `{ target_user_id, new_role }`.
- `workspace.member.removed` — metadata `{ target_user_id }`.

`object_type` = `workspace`, `object_id` = the workspace id. These sit
alongside existing audit events and are immutable.

## Client exposure

- `WorkspaceContext.role` is carried through `getRequestContext()` and is
  the canonical "what can this user do on the active workspace" signal.
- The sidebar workspace switcher lists every workspace the user has a
  membership row on (not only owned workspaces).
- The Settings → Members section renders only for `admin` and `owner`
  roles. All mutation server actions re-check role, so even a rendered
  surface cannot bypass the gate.
- Viewers never see Create / Edit / Delete controls in the product UI,
  but the server is the authoritative gate.

## OAuth for external connectors (v1.2)

Human session auth (Supabase cookies) and role gating are the
foundation. External integrations — Claude Desktop, OpenAI Apps,
custom MCP connectors — authenticate via an OAuth 2.1 + PKCE server
layered on top. Tokens are minted per `(user, client, workspace)` and
bound to a scope set at consent time. The workspace role gate runs
on every MCP request alongside the scope gate, so a token with
`context:generate` cannot perform writes if the user's role is
`viewer`. See
[`docs/mcp_oauth_and_secure_connector_architecture_v1.md`](mcp_oauth_and_secure_connector_architecture_v1.md)
for the full model; highlights:

- `/oauth/authorize` — user-facing consent page
- `/api/oauth/token` — `authorization_code` + `refresh_token` grants
- `/api/oauth/revoke` — RFC 7009 revocation
- `/api/mcp` — HTTP MCP transport that requires a Bearer access token
- Revoking a consent in Settings → Connected apps immediately
  invalidates every access + refresh token for that connector.

### Scope / role precedence

Workspace role and OAuth scope are orthogonal gates that both have
to pass. They are evaluated in this order on every MCP and canonical
API call:

1. **Role gate** (workspace membership). A `viewer` cannot write
   regardless of scope. A non-member cannot read, regardless of
   scope.
2. **Scope gate** (OAuth). Even if the user's role would permit an
   operation, the bearer token must carry the scope for that
   operation. A member with only `context:read` cannot propose
   writes through an OAuth-backed client — the connector has to
   ask for `context:propose` explicitly.
3. **Box-narrowing** (optional). If the token carries any
   `context:box:<uuid>` scopes, the accessible box set is the
   intersection of the user's workspace membership and the granted
   box ids. A token with no box scopes has workspace-wide access.

Scopes never broaden what role would allow; they only narrow it.
There is intentionally no `context:*` wildcard and no admin-level
capability scope — admin actions remain on the human UI.

### Primary vs legacy auth flows

- **Primary:** OAuth 2.1 + PKCE, access tokens prefixed `cso_a_`,
  refresh tokens `cso_r_`, resolved via
  `src/server/auth/mcp_auth_adapter.ts`.
- **Legacy (deprecated):** workspace-wide `csk_v1_` connection
  tokens described in [`connections_v1.md`](connections_v1.md).
  Only accepted when `CONTEXT_STORE_LEGACY_CSK_ENABLED=true` is set
  in the process environment. Every use emits a rate-limited
  `mcp.legacy_token_used` audit event and attaches standard
  deprecation response headers.

## MCP OAuth hardening updates (2026-04-13)

- `/api/mcp` and canonical `/api/v1/**` now resolve bearer auth through a unified resolver path.
- Workspace membership/role is re-checked live for OAuth tokens before request authorization.
- Viewer-role OAuth callers are forced into read-only behavior even if a connector requested write-capable scopes.
- Consent revocation invalidates all child access/refresh tokens for that `(user, client, workspace)` tuple.
