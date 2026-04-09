# Architecture

This document describes the intended module layout for Context Store and the reasoning behind each boundary.

---

## Guiding principles

1. **Server by default.** All data fetching happens on the server. Client components exist only for interactivity (menus, toggles, controlled inputs).
2. **Thin routes, thick services.** Route handlers and server actions validate inputs and delegate immediately. Business logic lives in services.
3. **No shared state across the server boundary.** Services do not share state with the client. Client state is UI state only.
4. **Clear layering.** `api → resolvers → services → repositories → database`. Each layer calls down, never up.

---

## Source tree

```
src/
├── app/                        Next.js App Router
│   ├── layout.tsx              Root layout (ThemeProvider, TooltipProvider)
│   ├── page.tsx                Landing / entry page
│   └── app/                    Authenticated product shell
│       ├── layout.tsx          AppShell wrapper
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
│       ├── empty_state.tsx     Empty list/view placeholder
│       ├── panel_section.tsx   Labeled section for panels and cards
│       ├── tree_stub.tsx       Hierarchical tree for box navigation
│       ├── note_stub.tsx       Note card for list views
│       └── metadata_panel_stub.tsx  Right-panel metadata view
│
├── lib/
│   ├── utils.ts                cn() class merger
│   ├── supabase/               (future) Supabase clients
│   ├── types.ts                (future) Shared domain types
│   ├── constants.ts            (future) App-wide constants
│   └── errors.ts               (future) Typed error classes
│
└── server/
    ├── api/                    Route handler layer (Next.js Route Handlers)
    ├── services/               Business logic layer
    ├── repositories/           Data access layer (Supabase queries)
    ├── policies/               Authorization checks
    ├── resolvers/              Server Actions
    └── mcp/                    MCP server implementation
```

---

## Domain model

Context Store has a strict information hierarchy. Do not flatten these into generic objects.

| Entity | Description |
|---|---|
| **Workspace** | Top-level organizational unit. A user has one or more workspaces. |
| **Box** | A focused collection within a workspace. Analogous to a project, topic, or domain. |
| **Folder** | Optional grouping within a box. Purely organizational — no semantic meaning beyond structure. |
| **Note** | The primary content unit. Markdown. Has a title, body, tags, and metadata. |
| **Guide note** | A special note kind that explains how to use a box or workspace. Surfaced prominently. |
| **Context bundle** | A curated, structured collection of context assembled for export or AI consumption. |

---

## Data flow

```
Browser request
  └── Next.js Route / Server Component
        └── Service
              ├── Policy check (can this user do this?)
              └── Repository (Supabase query)
                    └── Supabase (Postgres + RLS)

Client action (button, form)
  └── Server Action (resolvers/)
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

---

## Future prompts will add

- `src/lib/supabase/` — Supabase client setup
- `src/server/repositories/` — real data access
- `src/server/services/` — business logic
- `src/app/api/` — REST endpoints
- `src/server/mcp/` — MCP tools and resources
