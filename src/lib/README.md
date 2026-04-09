# src/lib

Shared utilities, constants, and infrastructure helpers.

## Current contents

- `utils.ts` — `cn()` class merger (clsx + tailwind-merge)

## Planned contents

- `supabase/client.ts` — browser Supabase client
- `supabase/server.ts` — server Supabase client (SSR-safe)
- `supabase/middleware.ts` — session refresh middleware helper
- `constants.ts` — product-wide constants (limits, defaults)
- `types.ts` — shared domain type definitions
- `errors.ts` — typed error classes (NotFound, Unauthorized, etc.)
- `format.ts` — date/time formatters, truncators

## Conventions

- No business logic here — lib is infrastructure, not domain
- Keep files small and single-purpose
- Prefer named exports over default exports
