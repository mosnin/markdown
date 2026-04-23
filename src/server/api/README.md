# src/server/api

API entrypoints for Context Store.

This folder is intentionally light because route handlers live under
`src/app/api/**/route.ts` (Next.js App Router convention). The API layer is
implemented and in active use.

## What is implemented now

- Route handlers under `src/app/api/**` for:
  - MCP (`/api/mcp`) and OAuth (`/api/oauth/*`)
  - Canonical API (`/api/v1/**`)
  - Workspace Operator and agent tool callbacks (`/api/operator/*`, `/api/agent/*`)
  - Internal jobs/webhooks (`/api/internal/*`, `/api/inngest`)
- Shared API response helpers in `src/lib/api/response.ts`
- Route-level auth resolution (cookie session, OAuth bearer, API key, or shared-secret envelope depending on surface)

## Conventions

- Keep route handlers thin: parse/validate input, resolve auth, delegate to services.
- Keep business rules in `src/server/services/*`.
- Keep direct DB access in `src/server/repositories/*`.
- Prefer returning explicit error codes using `apiOk` / `apiError` helpers.

## Notes

Historical planning notes in older docs may still refer to this layer as
"deferred"; that is no longer true.
