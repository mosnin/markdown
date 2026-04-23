# src/server/resolvers

Historical location for server-action resolver modules.

## Current state

In the current codebase, most server actions are colocated with route segments
under `src/app/**/actions.ts` rather than centralized in this folder.

Examples:

- `src/app/app/notes/actions.ts`
- `src/app/app/workspace_operator/actions.ts`
- `src/app/app/branches/actions.ts`
- `src/app/app/settings/**/actions.ts`

This folder is kept for architectural continuity and potential shared resolver
utilities, but the primary action surface is route-colocated.

## Conventions

- Server actions should be thin orchestrators.
- Delegate business logic to `src/server/services/*`.
- Use shared auth context/role guards and return typed action results.
