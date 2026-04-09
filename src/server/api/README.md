# src/server/api

Route handlers and API layer for Context Store.

## Planned contents

- `route.ts` files co-located with `src/app/api/**` routes
- Thin handlers that validate input, call services, and return responses
- No business logic — delegate to `../services`

## Conventions

- Use Next.js Route Handlers (`export async function GET/POST/...`)
- Validate request bodies with zod schemas
- Return consistent `{ data, error }` shapes
- Authentication middleware applied at the route level

## Not yet implemented

Auth, database, and endpoints are all deferred to later prompts.
