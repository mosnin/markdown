# Auth architecture

Context Store uses Supabase Auth with email magic links as the sole V1 sign-in method. This document covers the implementation structure, the session flow, and how to extend auth in later prompts.

---

## Overview

```
Browser request
  → middleware.ts           (session proxy — refreshes JWT silently)
  → Server Component        (getRequestContext / requireAuthenticatedUser)
  → page renders or redirects

Sign in flow:
  /sign_in (form)
    → signInWithEmail server action
    → Supabase sends magic link email
    → user clicks link → /auth/callback?code=xxx
    → exchangeCodeForSession (PKCE)
    → redirect to /app
```

---

## File map

| File | Purpose |
|---|---|
| `middleware.ts` | Next.js middleware entry point. Runs on all non-static requests. Delegates to `proxy.ts`. |
| `src/lib/supabase/proxy.ts` | Session refresh logic. Creates a Supabase client wired to request cookies and calls `getUser()` to refresh expired JWTs. |
| `src/lib/supabase/browser.ts` | Browser-side Supabase client factory. Use in Client Components only. |
| `src/lib/supabase/server.ts` | Server-side Supabase client factory. Use in Server Components, Server Actions, Route Handlers. |
| `src/server/auth/get_request_context.ts` | **The canonical entry point for auth state.** Returns `{ user, isAuthenticated }`. Extend this for workspace and permission context. |
| `src/server/auth/require_authenticated_user.ts` | Convenience guard. Calls `getRequestContext` and redirects to `/sign_in` if unauthenticated. |
| `src/app/sign_in/page.tsx` | Sign in page (server component, checks auth, redirects if already signed in). |
| `src/app/sign_in/sign_in_form.tsx` | Sign in form (client component, uses `useActionState`). |
| `src/app/sign_in/actions.ts` | Server action: `signInWithEmail` — calls Supabase OTP. |
| `src/app/auth/callback/route.ts` | Route handler that exchanges the magic link `code` for a session. |
| `src/app/app/actions.ts` | Server action: `signOut` — clears session and redirects to `/sign_in`. |
| `src/components/product/user_menu.tsx` | Client component: user email + sign out dropdown in the sidebar. |

---

## Session proxy

`middleware.ts` runs on every non-static request. It does **not** enforce route access — it only refreshes the Supabase session cookie so JWTs stay valid across page navigations.

Important: the proxy calls `supabase.auth.getUser()`, not `getSession()`. `getUser()` validates the JWT against the Supabase server, which is required for correct token refresh behavior.

---

## Route protection

Route protection is enforced in **server components**, not middleware. The pattern:

```ts
// In any protected layout or page:
const user = await requireAuthenticatedUser();
// If no session → automatic redirect('/sign_in')
// If session present → user object returned
```

The `/app` route tree is protected at `src/app/app/layout.tsx`, which means all child routes inherit the auth guard automatically.

### Why not middleware?

Middleware runs before the Next.js rendering pipeline. Route-level protection in server components is:
- More reliable (verifies with Supabase server, not just cookie presence)
- Easier to extend (workspace checks, permission checks)
- More composable (each layout can add its own guards)

---

## Request context

`getRequestContext()` is the single source of truth for auth state on the server.

```ts
const ctx = await getRequestContext();
// ctx.user        — Supabase User | null
// ctx.isAuthenticated — boolean
```

**Do not call `supabase.auth.getUser()` directly in product code.** Always go through `getRequestContext()` so that future extensions (workspace context, permissions) are available in the same call.

### Extending request context

When workspace and permissions are added, extend `RequestContext` in `get_request_context.ts`:

```ts
export interface RequestContext {
  user: User | null;
  isAuthenticated: boolean;
  // Add here:
  workspace: WorkspaceContext | null;
  permissions: PermissionContext | null;
}
```

And update `getRequestContext()` to resolve those fields after auth is confirmed. Everything downstream (`requireAuthenticatedUser`, layouts, pages) will automatically gain access.

---

## Magic link flow (detailed)

1. User visits `/sign_in`, submits email.
2. `signInWithEmail` server action calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })`.
3. Supabase sends an email with a link to `/auth/callback?code=xxx` (PKCE flow).
4. User clicks the link. `/auth/callback/route.ts` calls `supabase.auth.exchangeCodeForSession(code)`.
5. Supabase issues session cookies. Route redirects to `/app`.
6. Subsequent requests carry the session cookie. Middleware refreshes it silently.

### Supabase dashboard requirements

- **Enable Email OTP**: Authentication → Providers → Email → "Enable Email OTP"
- **Redirect URL allow-list**: Authentication → URL Configuration → Redirect URLs
  - Dev: `http://localhost:3000/auth/callback`
  - Prod: `https://your-domain.com/auth/callback`
- **Site URL**: Authentication → URL Configuration → Site URL

---

## Sign out

The `signOut` server action (in `src/app/app/actions.ts`) calls `supabase.auth.signOut()` and redirects to `/sign_in`. It's invoked from `UserMenu` in the sidebar.

---

## External API auth (bearer tokens)

API route handlers do not use the cookie-based session. Instead, they use a separate auth path: `getConnectionContext()`.

```
External API request
  → Authorization: Bearer csk_v1_<64hex>
  → getConnectionContext(request)
        → createAdminClient()  (service role, bypasses RLS)
        → lookup token by prefix
        → verify sha256 hash (timingSafeEqual)
        → load connection + box scopes
        → return ConnectionRequestContext
  → route handler checks ctx.allowedBoxIds
  → data queries use adminClient with explicit workspace_id filters
```

### Two auth systems — never mix

| Property | Human session (`getRequestContext`) | API token (`getConnectionContext`) |
|---|---|---|
| Client | Cookie-based (`createClient`) | Admin (`createAdminClient`) |
| RLS | Active | Bypassed — app-level filters required |
| Identity | Supabase `User` | `Connection` record |
| Scope | Workspace | Set of allowed boxes |
| Entry point | `get_request_context.ts` | `get_connection_context.ts` |

### Token format

```
csk_v1_<64 hex chars>
Bearer csk_v1_a3f9bc12d7...  (Authorization header)
```

Stored in DB:
- `token_prefix` = first 8 hex chars — indexed, used for fast lookup
- `secret_hash` = sha256 of the 64 hex chars — compared with timingSafeEqual

The raw secret is never persisted. It is shown to the user once at creation/rotation time.

### Admin client security contract

`createAdminClient()` uses the `SUPABASE_SERVICE_ROLE_KEY`, which bypasses all RLS policies.

Rules:
- NEVER use the admin client in human-facing product code. Only for API token auth.
- ALWAYS add explicit `workspace_id` and `box_id` ownership filters to every query.
- The admin client should only be called from `get_connection_context.ts` and API route handlers.

### Connection context type

```ts
interface ConnectionRequestContext {
  connection: Connection;      // The authenticated connection
  workspaceId: string;         // connection.workspace_id
  allowedBoxIds: Set<string>;  // connection_box_scopes → box_id set
  tokenId: string;             // For last_used_at tracking
}
```

See `src/server/auth/get_connection_context.ts` and `docs/connections_v1.md` for full details.

---

## Future extensions

| Feature | Where to add |
|---|---|
| OAuth providers (Google, GitHub) | New action in `sign_in/actions.ts` + new UI in `sign_in_form.tsx` |
| Workspace membership check | Extend `RequestContext`, resolve in `getRequestContext` |
| Role-based permissions | `src/server/policies/` + new field in `RequestContext` |
| Session expiry handling | Already covered by middleware proxy refresh |
| Account management (email change, etc.) | `src/app/app/settings/` + new actions |
| Token expiry enforcement | Set `connection_tokens.expires_at`; checked in `getConnectionContext` |
| Write proposals via API | Add `propose_writes` handler; check `permission_mode` in route handler |
