# src/server/policies

Authorization layer. Policies enforce access rules before services execute mutations.

## Planned contents

- `workspace_policy.ts` — can user read/write/admin this workspace?
- `box_policy.ts` — can user access this box?
- `note_policy.ts` — can user read/write/delete this note?
- `bundle_policy.ts` — can user export or share this bundle?

## Conventions

- Policy functions take `(userId, resource)` and return `boolean` or throw `Unauthorized`
- Policies are called by services, never by route handlers directly
- Keep policy logic thin — map to RLS rules in Supabase where possible

## Not yet implemented

Deferred to the auth and RBAC prompt.
