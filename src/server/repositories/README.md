# src/server/repositories

Data access layer. Repositories wrap Supabase queries and return typed domain objects.

## Planned contents

- `workspace_repository.ts`
- `box_repository.ts`
- `note_repository.ts`
- `folder_repository.ts`
- `bundle_repository.ts`
- `user_repository.ts`

## Conventions

- One repository per aggregate root
- Repositories accept typed inputs and return typed domain objects
- No business logic — pure data access
- Use the Supabase server client from `@/lib/supabase/server`

## Not yet implemented

Deferred to the database schema and Supabase integration prompt.
