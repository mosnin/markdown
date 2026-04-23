# src/server/policies

Authorization and policy guidance for Context Store.

## Current state

Policy enforcement is implemented across:

- Auth helpers and role guards in `src/server/auth/*`
  - e.g. `require_authenticated_user.ts`, `require_role.ts`,
    `get_request_context.ts`, `mcp_auth_adapter.ts`
- Service-level trust/permission checks
  - e.g. `object_trust_policy_service.ts`, `oauth_scope_service.ts`
- Database-level RLS and constraints (see `supabase/migrations/*`)

This folder currently contains only this README; policy code lives in auth and
service modules listed above.

## Conventions

- Enforce identity first (who is calling), then capability/role (what they may do).
- Keep authorization checks close to mutation boundaries.
- Keep a defense-in-depth model: route/action guard + service checks + RLS.
- Prefer explicit, auditable checks over implicit behavior.
