# src/server/resolvers

Server action resolvers. These are the Next.js Server Actions that the UI calls directly.

## Planned contents

- `note_resolvers.ts` — createNote, updateNote, deleteNote
- `box_resolvers.ts` — createBox, renameBox, archiveBox
- `workspace_resolvers.ts` — createWorkspace, updateWorkspace
- `bundle_resolvers.ts` — assembleBundle, exportBundle

## Conventions

- Resolvers are `"use server"` functions
- They validate input, check auth, and delegate to services
- They return typed results or throw user-facing errors
- They should not contain business logic

## Not yet implemented

Deferred to the server actions prompt.
