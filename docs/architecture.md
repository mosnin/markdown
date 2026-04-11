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

## Object model expansion (v2)

This section describes the additive expansion of the domain model from notes-only to four object types. All existing architecture is unchanged.

### Updated hierarchy

```
Workspace
  └── Box
        ├── Folder (optional)
        │     └── Note | File | Skill | Agent
        └── Note | File | Skill | Agent (root-level)
```

Notes remain the primary human document type. Files, Skills, and Agents are new first-class content types. All four participate in the shared `workspace_objects` structural registry.

### New tables

| Table | Purpose |
|---|---|
| `workspace_objects` | Flat registry of all content objects (note, file, skill, agent, folder) — enables uniform tree, search, and graph operations |
| `files` | Non-markdown artifact objects with a `canonical_format` |
| `skills` | Reusable functional building blocks, workspace-level or box-local |
| `agents` | Structured orchestrators with explicit `agent_type`, `model_hint`, `system_prompt` fields |
| `object_versions` | Shared immutable version history for files, skills, and agents (mirrors `note_versions`) |
| `object_links` | Heterogeneous semantic relationships between any two content objects — same 10-value vocabulary as `note_links` |
| `box_object_attachments` | Join table for attaching workspace-level reusable skills/agents into boxes by reference |

### New services

| Service | Responsibility |
|---|---|
| `file_service.ts` | File CRUD, version management, canonical format enforcement |
| `skill_service.ts` | Skill CRUD, reusability management, version management |
| `agent_service.ts` | Agent CRUD, reusability management, structured field management |
| `object_link_service.ts` | Cross-type `object_links` CRUD with same-workspace validation |
| `object_registry_service.ts` | Keep `workspace_objects` in sync with type-specific tables on every mutation |

### New constant module

`src/server/domain/constants/object_constants.ts` — `OBJECT_TYPE`, `SOURCE_FORMAT`, `AGENT_TYPE`, `OBJECT_STATUS`, and `OBJECT_CHANGE_ORIGIN` typed string-enum constants.

### New type modules

| Module | Exports |
|---|---|
| `src/server/domain/types/workspace_object.ts` | `WorkspaceObject` |
| `src/server/domain/types/file.ts` | `File` |
| `src/server/domain/types/skill.ts` | `Skill` |
| `src/server/domain/types/agent.ts` | `Agent` |
| `src/server/domain/types/object_version.ts` | `ObjectVersion` |
| `src/server/domain/types/object_link.ts` | `ObjectLink` |
| `src/server/domain/types/box_object_attachment.ts` | `BoxObjectAttachment` |

For the full object model design — taxonomy, canonical format semantics, reusable reference model, trust rules, versioning, and migration safety — see [docs/object_model_expansion_v1.md](object_model_expansion_v1.md).

---

## First-class object type surfaces (v3+)

Each object type now has a complete product surface:

| Type | Route | Editor | Right pane | Center tabs |
|---|---|---|---|---|
| Note | `/app/notes/[id]` | Document + Markdown | Info/Links/Bundle/History | — |
| File | `/app/files/[id]` | Code textarea | Info/Links/History | — |
| Skill | `/app/skills/[id]` | Code textarea (read-only page) | — | — |
| Agent | `/app/agents/[id]` | Code textarea (Source tab) | Info/Links/History | Overview/Source/Exports/Children/Skills/Relationships |

Agent routes handle all three identity contexts from a single stable URL:
- Workspace-level reusable agent: breadcrumb via `Workspace → Agents → Name`
- Box-local agent: breadcrumb via `Workspace → Box → Name`

Server actions for each type live at `src/app/app/{type}s/actions.ts`.

See type-specific documentation:
- Files: [docs/files_object_and_editor_v1.md](files_object_and_editor_v1.md)
- Agents: [docs/agents_object_and_editor_v1.md](agents_object_and_editor_v1.md)
- Reusable attach/reference model: [docs/reusable_attach_and_reference_model_v1.md](reusable_attach_and_reference_model_v1.md)

---

## Current implementation status (April 2026)

1. **Tree implementation** — **Complete.**
   - `TreeSidebar` uses `react-arborist` with custom node renderer for all five object types.
   - Built-in drag-drop reparenting via react-dnd, virtualized rendering, keyboard navigation.
   - Inline rename: double-click a node to edit; `onRename` dispatches to type-specific server actions.
   - `BoxContentsTree` (tree tab) also uses react-arborist (read-only mode).

2. **Graph surface** — **Complete.**
   - Graph uses `@xyflow/react` with `@dagrejs/dagre` for automatic hierarchical layout.
   - All five object types rendered as nodes. Both `note_links` and `object_links` shown as edges.
   - Interactive: pan, zoom, node dragging, click-to-select with detail panel. Read-only.

3. **Realtime precision** — **Mostly complete.**
   - `WorkspaceLiveRefresh` provides scoped push-based updates per page (workspace/library/box/folder/object scopes).
   - Tree sidebar has its own per-box realtime subscription with debounced refetch.
   - Box page, folder page, library pages, and workspaces page all have scoped `WorkspaceLiveRefresh`.
   - Active editors are protected from destabilizing refreshes via `protectWhileEditing`.
   - Remaining: per-tab precision within the box page (all tabs re-render together).

4. **Folder workspace parity** — **Complete.**
   - Folder pages have full breadcrumb navigation, lifecycle menu, AI policy toggle, rename,
     create actions, content grid for all child types, right context panel, and export.

5. **Library choices**
   - Tree: `react-arborist` v3 (react-dnd + react-window)
   - Graph: `@xyflow/react` v12 + `@dagrejs/dagre` v3
   - UI: shadcn v4 (Base UI, not Radix) + Tailwind CSS v4
   - Design tokens: oklch color system via CSS variables

For the active checklist, see [docs/remaining_scope_tracker.md](remaining_scope_tracker.md).

---

## Expanded trust model (Phase 3)

Phase 3 extended the trust, permissions, versioning, lifecycle, audit, and machine workflow model from notes to all four object types.

### New services

| Service | Responsibility |
|---|---|
| `object_trust_policy_service.ts` | `getObjectTrustPolicy`, `connectionCanDirectlyWrite`, `describeObjectTrustLevel` |
| `version_history_service.ts` | Extended with `listVersionsForObject`, `rollbackObjectToVersion` for files/skills/agents |
| `lifecycle_service.ts` | Extended with archive/unarchive/trash/restore for files, skills, agents |
| `audit_service.ts` | Extended with events for all object types: created, updated, archived, trashed, rollback, attach/detach, proposal_approved |

### New server actions

| File | Actions |
|---|---|
| `src/app/app/files/lifecycle_actions.ts` | `archiveFileAction`, `trashFileAction`, `restoreFileAction`, `rollbackFileAction` |
| `src/app/app/skills/lifecycle_actions.ts` | Same pattern for skills |
| `src/app/app/agents/lifecycle_actions.ts` | Same pattern for agents |

### New trust UI components (Phase 3)

| Component | Purpose |
|---|---|
| `shared_object_trust_badge.tsx` | `SharedObjectTrustBadge`, `ProposalOnlyBadge` |
| `object_trust_header.tsx` | `ObjectTrustHeader` — combined trust summary |
| `object_lifecycle_panel.tsx` | `ObjectLifecyclePanel` — archive/trash/restore UI |
| `heterogeneous_version_timeline.tsx` | `HeterogeneousVersionTimeline` — version list with rollback |
| `object_history_panel.tsx` | `ObjectHistoryPanel` — collapsible wrapper |
| `proposal_target_summary.tsx` | `ProposalTargetSummary` — proposal card header |
| `shared_reference_impact_notice.tsx` | `SharedReferenceImpactNotice`, `ReusableObjectDegradedBadge` |
| `connection_permission_hint.tsx` | `ConnectionPermissionHint` |
| `machine_provenance_panel.tsx` | `MachineProvenancePanel` — generated/imported provenance |
| `heterogeneous_proposal_card.tsx` | `HeterogeneousProposalCard` — proposal review for all object types |
| `skill_trust_panels.tsx` | `SkillHistoryPanel`, `SkillLifecycleControls` — client wrappers |
| `agent_trust_panels.tsx` | `AgentHistoryPanel`, `AgentLifecycleControls` — client wrappers |

For the full expanded trust model see [docs/expanded_object_trust_model_v1.md](expanded_object_trust_model_v1.md).

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
│   │   ├── audit_event.ts              AuditEvent
│   │   └── context_bundle.ts           ContextBundle (shared read model for API/MCP)
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
│   ├── guide_service.ts                Guide note assign/clear (boxes.guide_note_id)
│   ├── link_service.ts                 Note link CRUD with same-box validation
│   ├── search_service.ts               Box-scoped FTS via search_notes RPC
│   ├── overview_service.ts             Box hierarchy + link graph (bounded)
│   ├── system_guide_service.ts         Static structured product rules for API/MCP
│   ├── context_bundle_service.ts       Deterministic context bundle assembly
│   ├── write_proposal_service.ts       Create, approve, reject, preview, conflict detection
│   ├── generated_note_service.ts       Direct authorized note creation (generate_in_allowed_folders)
│   ├── diff_utils.ts                   computeDiffSummary, computeRollbackDiff (deterministic, no AI)
│   └── version_history_service.ts      listVersionsForNote, getVersionForNote, rollbackNoteToVersion
├── api/                                (future) Route handler layer
├── policies/                           (future) Authorization checks
└── mcp/                                MCP server (stdio, 12 tools, proxies canonical API)
    ├── index.ts                        Entrypoint — StdioServerTransport
    ├── server.ts                       McpServer factory
    ├── config.ts                       Env validation
    ├── errors.ts                       ApiError + error mapper
    ├── client/
    │   └── canonical_api_client.ts     HTTP client for /api/v1 routes
    └── tools/
        ├── register_tools.ts           Central tool registration
        ├── system_guide.ts             get_system_guide
        ├── boxes.ts                    list_boxes, get_box_guide, get_box_overview
        ├── notes.ts                    list_folder_contents, get_note, get_linked_notes, search_notes
        ├── bundles.ts                  get_context_bundle
        └── write_proposals.ts          create_write_proposal, list_write_proposals, create_generated_note
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

## Retrieval layer

See [docs/retrieval_layer_v1.md](retrieval_layer_v1.md) for the full retrieval architecture:

- Explicit note links (directional, same-box, typed)
- Keyword search (Postgres FTS, weighted fields, deterministic ranking)
- System guide (static product rules, reusable by API/MCP)
- Box guide (structured interpretation surface per box)
- Box overview (hierarchy + link graph, bounded)

## Context bundle

See [docs/context_bundle_v1.md](context_bundle_v1.md) for the bundle architecture:

- Bounded, deterministic retrieval package centered on one note
- Typed shared output (`ContextBundle`) usable by human UI, API, and MCP
- Assembly pipeline with explicit ownership checks
- Ancestor summary resolution via folder walk
- Configurable options: guide, ancestor summary, linked limit

## Shared markdown rendering

All markdown rendering goes through `src/lib/markdown.ts` → `renderMarkdown(content)`.
The `MarkdownPreview` component (`src/components/product/markdown_preview.tsx`) is the
shared client component. Sanitization can be added in one place here when needed.

## Portability layer

See [docs/import_export_v1.md](import_export_v1.md) for Notes/Folders/Boxes/Bundles.
See [docs/contextual_import_export_v1.md](contextual_import_export_v1.md) for Files/Skills/Agents (schema v1.1).

- Manifest schema v1.0 → Notes, Folders, Links, Bundles
- Manifest schema v1.1 → adds Files (`object_files`), Skills (`skills`), Agents (`agents`), cross-type links (`object_links`)
- Export modes: `canonical_source` (single raw file) | `packaged` (zip + manifest) — for Skills and Agents
- Workspace-level import: `importWorkspaceLevelPackageAction` — no box required for reusable skill/agent packages
- `is_reusable` is always preserved on import — never silently converted
- Delivery via `deliverExportPackage` (zip) or `deliverRawContent` (raw file) in `artifact_delivery_service.ts`
- `ImportSummaryReport` — typed per-object action log including files/skills/agents

```
src/server/services/
├── export_service.ts          Note/folder/box/bundle/file/skill/agent assembly → zip or raw
├── import_service.ts          Parse + validate + apply with collision handling (all object types)
└── artifact_delivery_service.ts  Package/raw content → Storage → signed URL

src/server/domain/types/
└── import_export.ts           ExportManifest (v1.0+v1.1), ImportSummaryReport, CollisionMode, ExportMode

src/app/app/import_export/
└── actions.ts                 Export/import server actions (all object types)

src/components/product/
├── export_menu.tsx            NoteExportMenu, BoxExportMenu (client)
├── import_dialog.tsx          ImportDialog, ImportTriggerButton, FolderImportButton (client)
└── note_import_dialog.tsx     NoteImportDialog, NoteImportButton — note-level import

src/app/app/notes/
└── actions.ts                 importIntoNoteAction, NoteImportMode — note-level import
```

**Contextual import** (see [contextual_import_flows_v1.md](contextual_import_flows_v1.md)):
Import is available at box, folder, and note level. Box/folder paths use `importPackageAction` with all four collision modes. Note-level import uses `importIntoNoteAction` with explicit `replace` / `append` modes; creates a new version with `change_origin = "import"`.

## External trust boundary (connections + canonical API)

See [docs/connections_v1.md](connections_v1.md) and [docs/canonical_api_v1.md](canonical_api_v1.md).

- Bearer token auth separate from human session auth — `get_connection_context.ts`
- Admin Supabase client (service role) for token lookup only — `src/lib/supabase/admin.ts`
- 16 canonical API endpoints under `src/app/api/v1/`
- Connection management UI in Settings → Connections

```
src/lib/supabase/
└── admin.ts                   Admin client factory (service role, bypasses RLS)

src/lib/api/
└── response.ts                apiOk(), apiError(), E_UNAUTHORIZED, E_FORBIDDEN, etc.

src/server/auth/
└── get_connection_context.ts  Bearer token → ConnectionRequestContext

src/server/services/
└── connection_service.ts      createConnection, rotateConnectionToken, revokeConnection, listConnectionsWithScopes

src/app/api/v1/
├── system_guide/route.ts
├── boxes/route.ts
├── boxes/[box_id]/
│   ├── box_guide/route.ts
│   ├── box_overview/route.ts
│   └── folder_contents/route.ts
├── notes/[note_id]/
│   ├── route.ts
│   ├── linked_notes/route.ts
│   └── versions/route.ts
├── search_notes/route.ts
├── context_bundles/route.ts
├── export_note/route.ts
├── export_folder/route.ts
├── export_box/route.ts
├── export_context_bundle/route.ts
├── write_proposals/route.ts
└── generated_notes/route.ts

src/app/app/settings/
└── connections_actions.ts     Server actions for UI

src/components/product/
└── connections_panel.tsx      ConnectionsPanel (create, list, rotate, revoke)
```

## Version history layer

See [docs/version_history_v1.md](version_history_v1.md) for the full version history architecture.

- **Immutable chain**: every note write appends a new `note_versions` row — no row is ever mutated
- **change_origin**: `human_edit`, `import`, `generated`, `proposal_approved`, `rollback`
- **diff_summary**: deterministic jsonb (title/body/summary/tags changed + byte delta) computed in TypeScript
- **Rollback**: human-only; creates a fresh version from the selected snapshot; history is preserved
- **Canonical API**: `GET /api/v1/notes/[id]/versions` for connection-authenticated reads; rollback not exposed

```
supabase/migrations/20260409000006_version_history_rpc.sql

src/server/services/
├── diff_utils.ts              computeDiffSummary, computeRollbackDiff
└── version_history_service.ts listVersionsForNote, getVersionForNote, rollbackNoteToVersion

src/app/api/v1/notes/[note_id]/
└── versions/route.ts          GET — paginated version list (connection-authenticated)

src/app/app/notes/[note_id]/
└── actions.ts                 rollbackNoteAction (human only, server action)

src/components/product/
└── note_history_panel.tsx     Version list + detail + rollback confirm (History tab)
```

## Machine write layer

See [docs/machine_write_v1.md](machine_write_v1.md) for the full machine write architecture.

- **Write proposals**: external connections propose changes (create/update/append/replace); humans review at `/app/proposals`
- **Generated notes**: `generate_in_allowed_folders` connections write directly to pre-authorized folders — no review
- **Optimistic locking**: `target_version_id` captured at proposal creation; conflicts detected atomically at approval time
- **Atomic SQL functions**: `approve_write_proposal_update`, `approve_write_proposal_create`, `create_generated_note_with_version`

```
supabase/migrations/20260409000005_machine_write_rpc.sql

src/server/services/
├── write_proposal_service.ts  Create, approve, reject, preview, conflict check
└── generated_note_service.ts  Direct authorized note creation

src/app/api/v1/
├── write_proposals/route.ts   POST (create), GET (list)
└── generated_notes/route.ts   POST (create)

src/app/app/proposals/
├── page.tsx                   Human review surface
└── actions.ts                 approveProposalAction, rejectProposalAction, setFolderGeneratedPolicyAction

src/components/product/
├── proposals_panel.tsx        Proposal cards with approve/reject + status filter
└── folder_policy_toggle.tsx   Folder accepts_generated_notes toggle (compact + full)
```

## MCP server

See [docs/mcp_v1.md](mcp_v1.md) for the full MCP architecture.

- Stateless stdio MCP server
- 12 tools: 9 read + 3 write (proposals + generated notes)
- Proxies all calls to the running Next.js app over HTTP — no direct DB access
- Auth via connection bearer token (`csk_v1_...`) — same as the external API

```
pnpm mcp       # run with tsx (dev)
pnpm build:mcp # compile to dist/mcp/ (prod)
```

## Lifecycle control layer

See [docs/lifecycle_controls_v1.md](lifecycle_controls_v1.md) for the full lifecycle architecture.

- **Human-only**: no lifecycle mutations exposed via API or MCP
- **States**: `active ↔ archived` (reversible hide), `active → trashed → active` (restore)
- **Subtree operations**: folder archive/trash/restore via atomic recursive-CTE SQL RPCs
- **Guide note protection**: note/folder operations blocked if content is the box's current guide note
- **Audit**: every lifecycle mutation fires an append-only audit event
- **Audit log UI**: `/app/audit` — read-only browser with actor/object-type filtering

```
supabase/migrations/20260409000007_lifecycle_rpc.sql

src/server/services/
├── lifecycle_service.ts       archiveNote/unarchiveNote/trashNote/restoreNote + folder + box variants
└── audit_view_service.ts      listWorkspaceAuditEvents, AUDIT_OBJECT_TYPES, AUDIT_EVENT_GROUPS

src/server/repositories/
├── note_repository.ts         listArchivedNotesByBox, listTrashedNotesByBox (added)
└── folder_repository.ts       listArchivedFoldersByBox, listTrashedFoldersByBox (added)

src/app/app/notes/[note_id]/
└── actions.ts                 archiveNoteAction, unarchiveNoteAction, trashNoteAction, restoreNoteAction

src/app/app/boxes/[box_id]/
└── actions.ts                 archiveFolderAction, unarchiveFolderAction, trashFolderAction, restoreFolderAction, archiveBoxAction, unarchiveBoxAction

src/app/app/audit/
├── page.tsx                   /app/audit route — audit event browser
└── actions.ts                 fetchAuditEventsAction

src/components/product/
├── note_lifecycle_menu.tsx    Note archive/trash/restore dropdown
├── folder_lifecycle_menu.tsx  Folder subtree archive/trash/restore dropdown
├── box_lifecycle_menu.tsx     Box archive/unarchive dropdown
└── audit_panel.tsx            Audit event list with filter + expand
```

## Relationship contract correction

See [docs/relationship_contract_correction_v1.md](relationship_contract_correction_v1.md).

- **Canonical vocabulary**: 10 relationship types replacing the original 5 (`related`, `depends_on`, `parent_of`, `child_of`, `reference_for`, `extends`, `example_of`, `sibling_of`, `supersedes`, `derived_from`)
- **Data migration**: `references` → `reference_for`, `contradicts` → `related` (deterministic, in migration `20260409000008`)
- **`relationship_note`**: first-class nullable text column on `note_links` — searchable, exported, imported
- **Search**: `search_notes` RPC updated to include `relationship_note` match via EXISTS subquery (no schema denormalization)
- **Context bundles**: `BundleLinkedNote` and `BundleRelationshipEdge` include `relationship_note`; importance ordering updated to 10-value map
- **Export/import**: `ManifestLink.relationship_note` now carries actual value (was always `null`)
- **Human UI**: `CreateLinkDialog` adds optional note textarea; `LinkedNotesSection` displays note inline

```
supabase/migrations/20260409000008_relationship_contract_correction.sql

src/server/domain/constants/note_constants.ts   RELATIONSHIP_TYPE (10 values)
src/server/domain/types/note_link.ts            NoteLink.relationship_note added
src/server/domain/types/context_bundle.ts       BundleLinkedNote, BundleRelationshipEdge updated
src/server/repositories/note_link_repository.ts CreateNoteLinkInput.relationship_note added
src/server/services/link_service.ts             createLink, updateLink accept relationship_note
src/server/services/context_bundle_service.ts   RELATIONSHIP_IMPORTANCE updated; relationship_note in edges
src/server/services/overview_service.ts         OverviewEdge.relationshipNote added
src/server/services/export_service.ts           toManifestLink uses actual relationship_note
src/server/services/import_service.ts           createNoteLink preserves relationship_note
src/app/api/v1/notes/[note_id]/linked_notes/route.ts  relationship_note in response
src/app/app/links/actions.ts                    createLinkAction/updateLinkAction accept relationship_note
src/components/product/create_link_dialog.tsx   10-value picker + optional note textarea
src/components/product/linked_notes_section.tsx 10-value labels; display relationship_note
```

## Product maturity layer

See [docs/onboarding_and_templates_v1.md](onboarding_and_templates_v1.md) and
[docs/accessibility_notes_v1.md](accessibility_notes_v1.md).

- **Templates**: structured box and note starting points; application calls normal service functions
- **Onboarding**: first-run callout on home page when workspace has no boxes; teaches the product mental model
- **Mobile nav**: `MobileSidebar` sheet-based drawer; `AppShell` renders mobile top bar on `< md` screens
- **Accessibility**: skip link, landmark semantics, `aria-current`, icon button labels, `role="alert"` on errors
- **Empty states**: improved copy across guide note picker, tree view, workspaces, linked notes, home page

```
src/lib/templates/
└── index.ts                   BOX_TEMPLATES, NOTE_TEMPLATES, getBoxTemplate, getNoteTemplate

src/app/app/boxes/actions.ts
├── createNoteAction            Extended: accepts optional markdownContent
└── applyBoxTemplateAction      Orchestrates template: folders + notes + guide assignment

src/components/product/
├── app_shell.tsx               Updated: skip link, <main> landmark, mobile top bar + MobileSidebar
├── app_sidebar.tsx             Updated: aria-current, nav/ul/li, aria-label on icon links
├── mobile_sidebar.tsx          New: Sheet-based left drawer with full nav hierarchy
├── onboarding_callout.tsx      New: First-run mental model callout (home page, no boxes)
├── create_box_dialog.tsx       Updated: template picker (BOX_TEMPLATES)
└── create_note_dialog.tsx      Updated: starter template picker (NOTE_TEMPLATES)
```

## Workspace layout layer

See [docs/workspace_layout_correction_v1.md](workspace_layout_correction_v1.md) for the
full workspace layout architecture.

- **Three-pane model**: `[sidebar 240px] | [center flex-1] | [right pane 288px]`; right pane hidden < lg; shell stays thin, pages own panel space
- **`TreeSidebar`**: client component, lazy-loads box tree via `getBoxTreeAction` on first expand, auto-expands current box from pathname
- **`AppSidebar` + `MobileSidebar`**: both use `TreeSidebar`; mobile uses Sheet drawer
- **Note editor**: two modes (Document / Markdown); Document mode is an editable proportional-font textarea for natural writing (default); Markdown mode is an editable monospace textarea labeled as the exact AI-facing source — both modes edit the same content string, no conversion
- **Autosave**: 1500ms debounce via `useEffect` + `useRef`; calls `saveNoteAction` (same as manual save); every autosave creates an immutable version via `update_note_and_create_version` RPC; see [docs/note_dual_view_and_autosave_v1.md](note_dual_view_and_autosave_v1.md)
- **`AutosaveStatus`**: five states — idle/unsaved/saving/saved/error; "unsaved" shows dim dot while timer runs; error shows Retry button and does not auto-dismiss
- **`SemanticLinksPanel`**: replaces `LinkedNotesSection` in right pane; "Context relationships" framing (not backlinks)
- **`GraphPanel`** + **`BoxGraphView`**: `GraphPanel` is a thin server component (stats + truncation warning); `BoxGraphView` is the interactive client component; hierarchy shown as spatial folder containers, semantic links as directed edge rows — two visually distinct edge types; guide note highlighted in amber; node selection reveals detail and highlights connected nodes; folder scope filter + hierarchy/links toggles; no D3 or force layout; see [docs/graph_view_v1.md](graph_view_v1.md)
- **Context intelligence surfaces**: see [docs/context_intelligence_surface_v1.md](context_intelligence_surface_v1.md) — right pane system, guide note front door, semantic link framing, retrieval signals, box guide as machine interpretation layer, precision search, context bundle presentation, machine workflow visibility
- **Workspace home (cockpit)**: status tiles + recent notes + boxes grid + connections + proposals
- **Box page**: guide status always above the fold; "Overview" tab renamed to "Graph" using `GraphPanel`
- **Note page**: center pane = breadcrumb + NoteEditor; right pane = Info/Links/Bundle/History tabs

```
src/app/app/page.tsx               Workspace cockpit (DashboardSection + DashboardCard)
src/app/app/boxes/[box_id]/page.tsx  Box operating surface (guide header, Graph tab)
src/app/app/notes/[note_id]/page.tsx  Note workspace (NoteEditor + NoteContextPanel)
src/app/app/boxes/actions.ts         Added: getBoxTreeAction (lazy tree data for sidebar)

src/components/product/
├── tree_sidebar.tsx               New: expandable box/folder/note tree (client)
├── autosave_status.tsx            New: autosave state indicator
├── note_editor.tsx                Rewritten: three modes + autosave
├── semantic_links_panel.tsx       New: context relationships panel
├── graph_panel.tsx                Updated: server wrapper (stats + truncation), delegates to BoxGraphView
├── box_graph_view.tsx             New: interactive client graph (hierarchy canvas + edge list + node detail)
├── dashboard_section.tsx          New: cockpit section wrapper
├── dashboard_card.tsx             New: cockpit card (link or static)
├── app_sidebar.tsx                Updated: uses TreeSidebar, 240px width
└── mobile_sidebar.tsx             Updated: uses TreeSidebar
```

## Starter and portability surface layer

See [docs/starter_and_portability_surface_v1.md](starter_and_portability_surface_v1.md)
for the full starter and portability architecture.

- **Onboarding**: `OnboardingCallout` shown when no boxes; teaches 6 concepts (Box, Folder, Note, Guide note, Explicit links, Context bundle); footer has Create Box CTA (with template mention) + import hint
- **Quick start**: `QuickStartPanel` shown when boxes exist but no notes yet; 3 instructional entries: import, template, guide note — all link to first box page
- **Templates**: Box template (Project context) available in `CreateBoxDialog`; note templates (Prompt, Agent, System, Guide note) in `CreateNoteDialog`; code-defined, no builder
- **Import**: Available at three levels — box (header button), folder (hover icon in Tree tab), note (top-bar button). Box/folder paths use `ImportDialog` with 4 collision modes. Note path uses `NoteImportDialog` with replace/append modes. See [contextual_import_flows_v1.md](contextual_import_flows_v1.md).
- **Export**: `NoteExportMenu` on note page; `BoxExportMenu` on box page; all descriptions include "signed link valid 1 hour"; guide note mention in bundle description
- **Empty states**: `EmptyState` component used consistently; box Notes tab, Tree tab, Search tab, audit, proposals, connections all have appropriate empty state copy

```
src/components/product/
├── onboarding_callout.tsx      Updated: 6 concepts (added Explicit links), import hint in footer
├── quick_start_panel.tsx       New: sparse workspace starter panel (server component)
├── import_dialog.tsx           Stable: modal with collision modes, summary panel
├── export_menu.tsx             Updated: improved what's-included descriptions for all 4 export types
└── box_contents_tree.tsx       Updated: improved empty tree message mentions Import
```

## Trust workspace surface layer

See [docs/trust_workspace_surface_v1.md](trust_workspace_surface_v1.md) for the full
trust surface architecture: proposal review, version history, audit browsing,
connections, and generated note provenance.

- **Proposal review** (`ProposalsPanel`): type-aware content preview — append proposals show the new portion separately (not the merged result); replace proposals get destructive border + warning; conflicted proposals show stale notice
- **Version history** (`NoteHistoryPanel`): actor type always shown as "Human" / "Connection" / "System" — not raw values; rollback confirm copy clarifies it creates a new version
- **Audit panel** (`AuditPanel`): human-readable event type labels (not raw dot-separated strings); actor filter uses `"connection"` not `"agent"` (which is not a valid ActorType); Bot icon for connection/system actors
- **Connections** (`ConnectionsPanel`): status badge shown when non-active (paused/revoked); usage count visible in expanded detail; permission mode descriptions explain write semantics
- **Generated note** (`GeneratedNoteBanner`): two-step promotion confirm; all signals disappear on promotion; origin_type preserved for provenance

```
src/components/product/
├── proposals_panel.tsx        Updated: type icons, type-aware ProposalContentPreview, replace card border
├── note_history_panel.tsx     Updated: ACTOR_LABEL map for version detail
├── audit_panel.tsx            Updated: EVENT_LABEL map, actor type fix (connection not agent), human labels
├── connections_panel.tsx      Updated: STATUS_CONFIG, status badge, usage_count in detail
└── generated_note_banner.tsx  Stable: promotion is already deliberate + two-step
```

## V1 parity pass

See [docs/v1_parity_report.md](v1_parity_report.md).

Targeted corrections applied after a systematic review against the original acceptance criteria:

- **Import guide note restoration**: `applyManifest` in `import_service.ts` now restores `boxes.guide_note_id` from the manifest's `is_guide_note` field after all notes are created. `guide_note.assigned` audit event fired on success.
- **Bundle read audit**: `POST /api/v1/context_bundles` now fires `bundle.read` audit event with `actor_type='connection'` after successful assembly. `auditBundleReadByConnection()` added to audit_service.
- **Note read response completeness**: `GET /api/v1/notes/[note_id]` now includes `origin_type`, `is_generated`, and `generated_by_connection_id` as specified in the generated note parity contract.
- **Template service extraction**: Box template orchestration moved from `applyBoxTemplateAction` to `template_service.ts`.

Stable ID resolution verified: all external API note lookups use UUID identity, not path. `path_cache` and `slug` are derived convenience fields only.

Relationship explanation parity verified: `relationship_note` is propagated through linked notes API, box overview, context bundles, export manifests, import restore, and the human UI.

Generated folder permission parity verified: four-layer check (permission_mode, box scope, folder policy, workspace ownership) confirmed in both route and service layers.

## Box creation performance

See [docs/box_creation_performance_fix_v1.md](box_creation_performance_fix_v1.md).

**Critical path rule**: box creation should only block on the DB insert + audit.
Template application is explicitly off the critical path — it runs as a background
client-side effect (`BoxTemplateSetup`) after navigation so the user lands in the
new box immediately.

**Revalidation after box creation** (`createBoxAction`):
- `revalidatePath('/app')` invalidates the home dashboard page and the
  `_N_T_/app/layout` tag, forcing `listBoxesByWorkspace()` to re-run so the
  sidebar shows the new box on the next navigation.
- `revalidatePath('/app/workspaces')` invalidates the workspace box list page.
- New box pages do not need explicit revalidation (fresh route).

**Guard pattern for background setup**:
Server components render the `BoxTemplateSetup` client component only when the
box is empty (`notes.length === 0 && folders.length === 0`). This prevents
accidental re-application to boxes with existing content (bookmarked URLs,
shared links, etc.).

## Document editing and real-time sync

See [docs/document_editing_and_realtime_fix_v1.md](document_editing_and_realtime_fix_v1.md).

**Document mode editing**: Document mode is now an editable textarea with proportional
font. Users write naturally without markdown syntax. Switching to Markdown mode shows the
same content string in monospace with a label indicating it is the exact AI-facing source.
No conversion happens between modes; both edit the same `content` state.

**Supabase Realtime**: `TreeSidebar` subscribes to `postgres_changes` on `notes`,
`folders`, and `boxes` tables filtered by `workspace_id`. On notes/folders change, the
affected box's tree is re-fetched with a 300ms debounce (coalesces bursts like template
application). On boxes change, `router.refresh()` triggers a server re-render so the box
list updates. The subscription is scoped to the workspace and only refreshes trees that
are already loaded (collapsed boxes are not pre-fetched).

**Immediate QuickCreate sync**: After creating a note or folder via `BoxQuickCreateMenu`,
the tree is refreshed immediately via `fetchTree(boxId)` — before waiting for the realtime
event — so the new item appears in the sidebar within milliseconds of navigation.

```
src/components/product/
├── note_editor.tsx          Updated: document mode = editable textarea (proportional font)
├── tree_sidebar.tsx         Updated: Supabase Realtime subscription + onTreeRefresh callback
├── app_sidebar.tsx          Updated: workspaceId prop → TreeSidebar
└── mobile_sidebar.tsx       Updated: workspaceId prop → TreeSidebar

src/app/app/layout.tsx       Updated: passes workspaceId to AppSidebar + MobileSidebar
```

## Future prompts will add

- `src/server/policies/` — authorization checks
