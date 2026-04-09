# Architecture

This document describes the intended module layout for Context Store and the reasoning behind each boundary.

---

## Guiding principles

1. **Server by default.** All data fetching happens on the server. Client components exist only for interactivity (menus, toggles, controlled inputs).
2. **Thin routes, thick services.** Route handlers and server actions validate inputs and delegate immediately. Business logic lives in services.
3. **No shared state across the server boundary.** Services do not share state with the client. Client state is UI state only.
4. **Clear layering.** `api → resolvers → services → repositories → database`. Each layer calls down, never up.
5. **Single source of truth for auth.** All server-side auth state comes from `getRequestContext()`. Do not call Supabase auth methods directly in product code.

---

## Source tree

```
middleware.ts                   Session proxy — refreshes Supabase JWT on every request

src/
├── app/                        Next.js App Router
│   ├── layout.tsx              Root layout (ThemeProvider, TooltipProvider)
│   ├── page.tsx                Landing / entry page
│   ├── sign_in/
│   │   ├── page.tsx            Sign in page (server, redirects if authenticated)
│   │   ├── sign_in_form.tsx    Sign in form (client, useActionState)
│   │   └── actions.ts          signInWithEmail server action
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts        Magic link callback — exchanges code for session
│   └── app/                    Authenticated product shell
│       ├── layout.tsx          Auth gate (requireAuthenticatedUser) + AppShell
│       ├── actions.ts          signOut server action
│       ├── page.tsx            Home / recent activity
│       ├── workspaces/
│       │   └── page.tsx        Workspace list
│       ├── boxes/
│       │   └── [box_id]/
│       │       └── page.tsx    Box content view
│       ├── notes/
│       │   └── [note_id]/
│       │       └── page.tsx    Note detail view
│       └── settings/
│           └── page.tsx        User settings
│
├── components/
│   ├── ui/                     shadcn/ui primitives (do not modify directly)
│   └── product/                Context Store product components
│       ├── app_shell.tsx       Root layout shell (sidebar + main + right panel)
│       ├── app_sidebar.tsx     Left navigation rail
│       ├── app_header.tsx      Top command bar
│       ├── page_header.tsx     Per-page title/action bar
│       ├── theme_provider.tsx  next-themes wrapper (client)
│       ├── theme_toggle.tsx    Light/dark toggle button (client)
│       ├── user_menu.tsx       User email + sign out dropdown (client)
│       ├── empty_state.tsx     Empty list/view placeholder
│       ├── panel_section.tsx   Labeled section for panels and cards
│       ├── tree_stub.tsx       Hierarchical tree for box navigation
│       ├── note_stub.tsx       Note card for list views
│       └── metadata_panel_stub.tsx  Right-panel metadata view
│
├── lib/
│   ├── utils.ts                cn() class merger
│   ├── supabase/
│   │   ├── browser.ts          Browser Supabase client (Client Components)
│   │   ├── server.ts           Server Supabase client (Server Components, Actions)
│   │   └── proxy.ts            Session refresh logic (used by middleware)
│   ├── types.ts                (future) Shared domain types
│   ├── constants.ts            (future) App-wide constants
│   └── errors.ts               (future) Typed error classes
│
└── server/
    ├── auth/
    │   ├── get_request_context.ts      Current user + auth status (canonical)
    │   └── require_authenticated_user.ts  Auth guard with redirect
    ├── api/                    Route handler layer (Next.js Route Handlers)
    ├── services/               Business logic layer
    ├── repositories/           Data access layer (Supabase queries)
    ├── policies/               Authorization checks
    ├── resolvers/              Server Actions
    └── mcp/                    MCP server implementation
```

---

## Auth layer

See [docs/auth.md](auth.md) for the detailed auth architecture.

The short version:

- **`middleware.ts`** refreshes the Supabase JWT on every non-static request. It does not enforce routes.
- **`src/server/auth/get_request_context.ts`** is the single entry point for server-side auth state. All product code uses this.
- **`src/server/auth/require_authenticated_user.ts`** is the route guard. Called at the top of protected layouts.
- **`/app/layout.tsx`** calls `requireAuthenticatedUser()`, protecting the entire `/app` tree.

---

## Request context

`getRequestContext()` returns the canonical per-request context:

```ts
const ctx = await getRequestContext();
// ctx.user            — Supabase User | null
// ctx.isAuthenticated — boolean
// ctx.workspace       — WorkspaceContext | null (non-null when authenticated)
// Future: ctx.permissions
```

For authenticated requests, `getRequestContext()` also resolves the user's workspace via `getOrCreateDefaultWorkspace()` — bootstrapping a default workspace on first access if none exists. All downstream code can safely assume `ctx.workspace` is non-null whenever `ctx.isAuthenticated` is true.

Extend `RequestContext` in `get_request_context.ts` when further context is needed. Everything downstream gains access automatically.

---

## Domain model

Context Store has a strict information hierarchy. Do not flatten these into generic objects.

| Entity | Description |
|---|---|
| **Workspace** | Top-level organizational unit. In V1, each user owns exactly one workspace. |
| **Box** | A focused collection within a workspace. Analogous to a project, topic, or domain. |
| **Folder** | Optional grouping within a box. Purely organizational — no semantic meaning beyond structure. |
| **Note** | The primary content unit. Markdown. Has a title, body, tags, and metadata. |
| **Guide note** | A note with `kind = 'guide'`. The canonical assignment is `boxes.guide_note_id`. |
| **Context bundle** | A note with `kind = 'bundle'` — curated context assembled for export or AI consumption. |
| **Connection** | An authorized external agent (MCP client, API) with scoped box access. |
| **Write proposal** | A connection's proposed note change pending human review. |

For the full schema, column definitions, RLS policies, and design decisions see [docs/data_model.md](data_model.md).

---

## Data flow

```
Browser request
  └── middleware.ts            (session refresh only)
  └── Next.js Route / Server Component
        └── getRequestContext() / requireAuthenticatedUser()
        └── Service
              ├── Policy check (can this user do this?)
              └── Repository (Supabase query)
                    └── Supabase (Postgres + RLS)

Client action (button, form)
  └── Server Action (resolvers/ or co-located actions.ts)
        └── Service
              ├── Policy check
              └── Repository
```

---

## Component conventions

- **Server components by default.** No `"use client"` unless the component uses hooks, browser APIs, or event handlers.
- **Product components live in `src/components/product/`**, named in `snake_case` to distinguish from shadcn primitives.
- **shadcn primitives live in `src/components/ui/`** and are not modified directly. Override through composition.
- **No barrel files.** Import directly from the module file, not from an index re-export.
- **shadcn v4 uses Base UI, not Radix.** No `asChild` prop. Use `render={<element />}` for polymorphism.

---

## Server layer

```
src/server/
├── auth/
│   ├── get_request_context.ts          Canonical per-request context (user + workspace)
│   └── require_authenticated_user.ts   Auth guard; redirects to /sign_in if unauthenticated
├── domain/
│   ├── constants/                      Typed string-enum constants (status values, kinds, etc.)
│   │   ├── content_status.ts           WORKSPACE_STATUS, BOX_STATUS, FOLDER_STATUS, NOTE_STATUS
│   │   ├── note_constants.ts           NOTE_KIND, NOTE_ORIGIN_TYPE, RELATIONSHIP_TYPE
│   │   ├── connection_constants.ts     CONNECTION_TYPE, CONNECTION_STATUS, PERMISSION_MODE, TOKEN_STATUS
│   │   └── audit_constants.ts          ACTOR_TYPE, CHANGE_ORIGIN, PROPOSAL_TYPE, PROPOSAL_STATUS
│   ├── types/                          TypeScript interfaces matching DB table shapes
│   │   ├── workspace.ts                Workspace, WorkspaceContext
│   │   ├── box.ts                      Box
│   │   ├── folder.ts                   Folder
│   │   ├── note.ts                     Note
│   │   ├── note_version.ts             NoteVersion
│   │   ├── note_link.ts                NoteLink
│   │   ├── connection.ts               Connection, ConnectionToken, ConnectionBoxScope
│   │   ├── write_proposal.ts           WriteProposal
│   │   └── audit_event.ts              AuditEvent
│   └── schemas/                        Zod v4 schemas for repository inputs
│       ├── workspace_schemas.ts        CreateWorkspaceInput, UpdateWorkspaceInput
│       ├── box_schemas.ts              CreateBoxInput, UpdateBoxInput
│       └── note_schemas.ts             CreateNoteInput, UpdateNoteInput
├── repositories/                       Data access layer (Supabase queries only, no business logic)
│   ├── workspace_repository.ts
│   ├── box_repository.ts
│   ├── folder_repository.ts
│   ├── note_repository.ts
│   ├── note_version_repository.ts
│   ├── note_link_repository.ts
│   ├── audit_event_repository.ts
│   ├── connection_repository.ts
│   └── write_proposal_repository.ts
├── services/                           Business logic layer
│   ├── workspace_bootstrap/
│   │   └── get_or_create_default_workspace.ts
│   ├── audit_service.ts                Audit event helpers (append-only, fire-and-forget)
│   ├── box_service.ts                  Box CRUD, slug generation, ownership checks
│   ├── folder_service.ts               Folder CRUD, path_cache derivation and cascade
│   ├── note_service.ts                 Note create/update via atomic RPC functions
│   └── guide_service.ts                Guide note assign/clear (boxes.guide_note_id)
├── api/                                (future) Route handler layer
├── policies/                           (future) Authorization checks
└── mcp/                                (future) MCP server implementation
```

## Atomicity: note versioning

Note creation and editing are the only operations that require strict atomicity.
Both go through Postgres RPC functions defined in migration `20260409000003`:

- `create_note_with_initial_version(...)` — inserts note + version_1 + updates `current_version_id` in one transaction
- `update_note_and_create_version(...)` — inserts a new version + updates note content and `current_version_id` in one transaction

`note_service.ts` calls these via `supabase.rpc()`. Application-layer retry is not used — the function either succeeds atomically or throws.

## Page layout pattern

Pages that need a right panel (box, note) use an inline flex layout rather than
AppShell's `rightPanel` prop:

```tsx
<div className="flex h-full overflow-hidden">
  <div className="flex-1 flex-col overflow-hidden">…main…</div>
  <aside className="hidden lg:flex lg:w-72 lg:border-l">…panel…</aside>
</div>
```

The AppShell in the layout provides only the sidebar. Pages own their own panel space.

## Future prompts will add

- `src/server/api/` — REST endpoints
- `src/server/mcp/` — MCP tools and resources
- `src/server/policies/` — authorization checks
- Note links, search, context bundles, connection management
