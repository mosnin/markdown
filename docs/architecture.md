# Architecture

Poggle is a Next.js 16.2.3 / React 19.2.4 application backed by Supabase (Postgres + Auth + Storage + Realtime). It runs in two deployment targets: a Vercel-hosted web application and a Modal Python operator harness (external to this repo). Background work is coordinated by Inngest 3.27.0.

This document describes the layered module structure, runtime topology, core data model, and the major subsystems.

---

## Runtime topology

```
Browser
  └── Next.js (Vercel / self-hosted)
        ├── App Router pages  (React Server Components + Client Components)
        ├── Server Actions     ("use server", cookie-scoped Supabase client)
        ├── API route handlers (Next.js Route Handlers, Bearer-token auth)
        └── Inngest endpoint   (/api/inngest — durable function runner)

Supabase
  ├── Postgres (RLS-enforced, 91 migrations as of 2026-04-28)
  ├── Auth     (sessions, JWT, workspace bootstrap on first sign-in)
  ├── Storage  ("note-images" bucket, public CDN)
  └── Realtime (Yjs CRDT sync channel per note)

Modal (external)
  └── Workspace operator harness (Python, long-running agent execution)
        └── calls back via POST /api/operator/runs

Inngest (cloud queue)
  └── /api/inngest receives events and runs durable TypeScript functions
```

---

## Layered architecture

```
src/
├── app/                      Next.js App Router
│   ├── app/                  Authenticated product pages (RSC + actions)
│   └── api/                  Route handlers
├── server/
│   ├── auth/                 requireAuthenticatedUser(), getRequestContext()
│   ├── domain/               Pure types + constants (no I/O)
│   │   ├── types/            One interface per DB table
│   │   ├── constants/        Enums / literal union constants
│   │   ├── schemas/          Zod validation schemas
│   │   └── workflow_templates.ts  Built-in workflow template registry
│   ├── repositories/         Thin DB accessors (Supabase queries, no biz logic)
│   └── services/             Business logic (compose repositories + external calls)
├── lib/
│   ├── supabase/             Client factories (browser, server, admin)
│   ├── inngest/              Typed client + all function definitions
│   ├── crdt/                 Yjs provider, awareness, hook
│   ├── api/                  Shared route handler helpers (rate_limit, response)
│   ├── embedding/            Embedding utility
│   └── hooks/                Shared React hooks
└── components/               UI components (shadcn/ui base + product-specific)
```

### Layer rules

| Layer | May import | Must NOT import |
|---|---|---|
| `domain/types` | Nothing | Everything else |
| `repositories` | `domain/`, `lib/supabase` | `services/`, `components/` |
| `services` | `repositories/`, `domain/`, `lib/` | `app/`, `components/` |
| `app/` server actions | `services/`, `repositories/`, `server/auth/` | Browser-only APIs |
| `app/` client components | `lib/hooks/`, `components/` | `server/`, `lib/supabase/server` |

---

## Authentication and authorization

Every protected page and server action begins with:

```ts
const ctx = await requireAuthenticatedUser();
// ctx.user     — Supabase Auth user (non-null)
// ctx.workspace — WorkspaceContext with caller's role
```

`requireAuthenticatedUser()` (`src/server/auth/require_authenticated_user.ts`) calls `getRequestContext()`, which reads the Supabase cookie session and resolves the workspace via workspace_memberships. It redirects to `/sign_in` if unauthenticated.

### Row Level Security

All workspace-scoped tables enforce RLS through `workspace_memberships`. The per-user cookie Supabase client (created by `src/lib/supabase/server.ts`) is used for all product reads/writes; RLS applies automatically.

The admin client (`src/lib/supabase/admin.ts`, `SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS. It is used only in:
- Inngest background functions (no user session context)
- Operator API route handlers authenticating a Bearer token
- Deployment scripts

---

## Core data model

The primary workspace-scoped objects are: Box → Note → NoteVersion. Everything else links to one of those anchors.

```
Workspace
  ├── workspace_memberships  (owner / admin / member / viewer roles)
  ├── Box                    (top-level container, can have a guide_note_id)
  │   ├── Note               (markdown_content + Yjs CRDT, kind: note/guide/bundle)
  │   │   ├── NoteVersion    (immutable version history)
  │   │   ├── NoteLink       (explicit note→note relationships)
  │   │   └── entity_mentions (extracted knowledge-graph refs)
  │   └── Folder             (hierarchical grouping within a box)
  ├── Entity / EntityEdge    (knowledge graph nodes + typed edges)
  ├── Insight                (atomic insights extracted from notes)
  ├── KgBackfillJob          (async KG backfill tracking)
  ├── Agent                  (autonomous agent configuration)
  ├── AgentTrigger           (cron or note-event trigger for an agent)
  ├── AgentTriggerRun        (execution record for a trigger firing)
  ├── Skill                  (reusable agent skill / plugin)
  ├── Workflow               (DAG workflow definition)
  ├── WorkflowRun            (execution record)
  ├── Connection             (OAuth or token credential store)
  ├── WriteProposal          (pending AI-proposed change, requires approval)
  ├── SubagentInvocation     (child agent dispatch record)
  ├── WebToolUsage           (web tool call record)
  └── WorkspaceObject        (polymorphic object registry for links + branches)
```

Domain types live under `src/server/domain/types/`. Every interface maps 1-to-1 with a Postgres table.

---

## Supabase client factories

| Export | File | Auth mechanism | When to use |
|---|---|---|---|
| `createBrowserClient()` | `lib/supabase/browser.ts` | Cookie / localStorage | Client components |
| `createClient()` | `lib/supabase/server.ts` | Cookie (server) | Server actions, RSC pages |
| `createAdminClient()` | `lib/supabase/admin.ts` | Service role key | Inngest fns, operator routes, scripts |
| `createProxyClient()` | `lib/supabase/proxy.ts` | Bearer token | Operator harness proxying user ops |

---

## App pages (`src/app/app/`)

All pages live under the authenticated layout at `src/app/app/layout.tsx`. React Server Components fetch data directly; client interactivity is delegated to `"use client"` leaf components.

| Route | Description |
|---|---|
| `/app/dashboard` | Overview feed and quick-create actions |
| `/app/notes` | All notes list |
| `/app/boxes` | Box browser |
| `/app/folders` | Folder tree |
| `/app/files` | File attachments |
| `/app/graph` | Knowledge graph visual explorer |
| `/app/entities` | Entity browser (KG nodes) |
| `/app/insights` | Atomic insights feed |
| `/app/search` | Full-text + semantic search |
| `/app/agents` | Agent configuration and runs |
| `/app/sub_agents` | Sub-agent dispatch history |
| `/app/web_sessions` | Browsing session history |
| `/app/skills` | Skill library |
| `/app/workflows` | Workflow list + canvas editor |
| `/app/workspace_operator` | Operator runs and configuration |
| `/app/conversation` | Conversational AI interface |
| `/app/connections` | OAuth / API credential manager |
| `/app/audit` | Audit event log |
| `/app/activity` | Workspace activity feed |
| `/app/analytics` | Usage analytics charts |
| `/app/usage` | Usage dashboard (token / run breakdown) |
| `/app/history` | Version history browser |
| `/app/import_export` | Import / export workspace data |
| `/app/proposals` | Write-proposal review queue |
| `/app/settings` | Workspace and user settings |
| `/app/branches` | Branch management |
| `/app/daily_note` | Daily note shortcut |
| `/app/workspaces` | Workspace switcher |

---

## API routes (`src/app/api/`)

### Agent tool endpoints (`/api/agent/tools/`)

The operator harness calls these from Modal via Bearer token:

| Endpoint | Purpose |
|---|---|
| `apply_template` | Apply a note template to an existing note |
| `archive_note` | Archive a note |
| `await_subagent` | Poll a dispatched sub-agent run for completion |
| `browse_session_end` | Terminate a Browserbase session |
| `browse_session_start` | Start a new Browserbase browsing session |
| `browse_session_step` | Execute a step within a browsing session |
| `deep_search` | Exa-backed deep semantic search |
| `draft_note` | Create a new draft note |
| `edit_note` | Apply a markdown patch to a note |
| `execute_code` | Run code in a sandboxed executor |
| `inline_command_complete` | Mark an inline AI command as complete |
| `invoke_subagent` | Dispatch a child agent |
| `link_notes` | Create an explicit note-to-note link |
| `list_notes_in_box` | List notes in a given box |
| `list_skills_plugins` | List available skill plugins |
| `memories` | Read / write agent memory entries |
| `move_note` | Move a note to a different folder or box |
| `persona` | Read agent persona configuration |
| `progress` | Report run progress back to the client |
| `propose_box_structure` | Propose box reorganization |
| `read_note` | Read a note's markdown content |
| `rename_note` | Rename a note |
| `run_memory` | Execute a memory query |
| `search` | Workspace search (FTS + semantic) |
| `subagent_complete` | Signal sub-agent completion |
| `trace` | Write a structured trace event |
| `web_fetch` | Fetch a URL (SSRF-guarded) |
| `web_search` | Brave/Exa web search |
| `workspace_context` | Return workspace metadata for the agent |

### Other API routes

| Route | Purpose |
|---|---|
| `POST /api/auth/...` | Supabase Auth callbacks |
| `POST /api/inngest` | Inngest event endpoint |
| `POST /api/operator/runs` | Operator harness run callbacks |
| `GET /api/health` | Health check (used by deploy_check.ts) |
| `POST /api/voice/transcribe` | Whisper transcription (10/min/user) |
| `POST /api/agent/operator` | Operator run creation |
| `GET/POST /api/agent/memories` | Agent memory CRUD |
| `GET/POST /api/agent/personas` | Agent persona CRUD |
| `GET /api/mcp/...` | MCP protocol endpoint |
| `GET /api/oauth/...` | OAuth server endpoints |
| `POST /api/billing/...` | Billing webhooks |
| `GET/POST /api/v1/...` | Public REST API (notes, boxes, search, etc.) |
| `GET /api/internal/...` | Internal admin endpoints |

---

## Inngest background functions

Inngest provides durable, retryable background execution. All functions are registered at `src/lib/inngest/functions/index.ts`.

| Function file | Trigger | Description |
|---|---|---|
| `run_agent_execution.ts` | `agent_trigger.manual` | Runs a configured agent for a manual trigger |
| `execute_note_trigger.ts` | `note.created`, `note.updated` | Fires note-event agent triggers |
| `execute_manual_trigger.ts` | `agent_trigger.manual` | Executes a manual agent trigger |
| `execute_scheduled_triggers.ts` | Cron | Polls `agent_triggers` table for due cron triggers |
| `execute_workflow.ts` | `workflow.run` | Executes a workflow DAG (interprets node graph) |
| `clear_stuck_trigger_runs.ts` | Cron | Marks timed-out trigger runs as failed |

### Typed event registry (`src/lib/inngest/events.ts`)

| Event name | Data payload |
|---|---|
| `note.created` | `workspaceId`, `noteId`, `boxId`, `userId` |
| `note.updated` | `workspaceId`, `noteId`, `boxId`, `userId`, `isFirstSave` |
| `agent_trigger.manual` | `triggerId`, `workspaceId`, `userId` |
| `workflow.run` | `workflowId`, `workspaceId`, `userId`, `input`, `runId` |

---

## CRDT collaborative editing

Notes use Yjs (`^13.6.20`) for real-time collaborative editing via Supabase Realtime as the sync transport.

| File | Role |
|---|---|
| `src/lib/crdt/supabase_yjs_provider.ts` | Supabase Realtime ↔ Yjs sync provider |
| `src/lib/crdt/use_note_yjs_doc.ts` | React hook: creates/syncs the Y.Doc for a note |
| `src/lib/crdt/yjs_awareness.ts` | Cursor awareness (who is editing) |

The editor is CodeMirror 6 (`@codemirror/state ^6.6.0`) with `y-codemirror.next` binding the Yjs text type to the CodeMirror document.

---

## Workflow engine

Workflows are user-defined DAGs executed by the `execute_workflow` Inngest function.

- **Definition**: stored as JSON in `workflow_nodes` + `workflow_edges` tables.
- **Canvas**: `@xyflow/react ^12.10.2` renders the drag-and-drop graph editor.
- **Node types**: `start`, `ai_task`, `condition`, `loop`, `subagent`, `webhook`, and custom tool nodes.
- **Triggers**: manual run, cron schedule (stored in `agent_triggers`, polled by Inngest), or API call.
- **Templates**: 5 built-in templates in `src/server/domain/workflow_templates.ts` — available via the "New from template" flow.
- **Server actions**: `src/app/app/workflows/actions.ts` — create, save, run, schedule, get, list.

See `docs/workflows_v1.md` for the full reference.

---

## Knowledge graph

Entities and their typed edges are extracted from notes by background jobs.

- **Entities** (`public.entities`): named concepts/people/places linked to source notes via `entity_mentions`.
- **EntityEdges**: typed directional relationships between entities.
- **Insights** (`public.insights`): atomic facts extracted from note content.
- **KgBackfillJob**: tracks async re-processing of notes for KG extraction.
- **GraphRAG**: `src/server/services/graph_rag_service.ts` retrieves context by combining vector similarity with graph traversal.

See `docs/knowledge_graph_v1.md` for the full reference.

---

## Web agents

The workspace operator harness (Modal, Python) runs long-horizon agents that call back into `/api/agent/tools/*` endpoints using a Bearer token tied to a `Connection` row.

- **Browsing**: Browserbase managed Chrome sessions (`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`).
- **Search**: Exa deep-search API (`EXA_API_KEY`).
- **Sub-agents**: hierarchical dispatch via `invoke_subagent` / `await_subagent` tool endpoints.
- **Memory**: persistent key-value memory per agent via the `memories` endpoint.
- **Rate limiting**: all tool endpoints enforce per-workspace rate limits via `src/lib/api/rate_limit.ts`.

See `docs/web_agents_v1.md` for the full reference.

---

## Branches

Poggle supports draft branches: a parallel overlay of workspace content that can be promoted (merged) or discarded.

- Every content table has an optional `branch_id` column. Null = trunk.
- `src/server/services/branch_service.ts` and related `*_branch_service.ts` files handle creation, diff, rebase, promotion, rollback, and conflict detection.
- Branch-local structural objects (notes, folders, boxes created on a branch) are created by `createNoteOnBranch` and cleared on promote / hard-deleted on discard.
- Branch promotion is atomic via Postgres RPC (`lifecycle_rpc.sql`).

---

## External services and required credentials

| Service | Env var(s) | Used by |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | All layers |
| OpenAI | `OPENAI_API_KEY` | Voice transcription, AI completions |
| Embedding API | `EMBEDDING_API_KEY` | `embedding_service.ts`, image description |
| Inngest | `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Background functions |
| Modal | `MODAL_BASE_URL` | Operator harness health check (optional) |
| Exa | `EXA_API_KEY` | `exa_search_service.ts`, deep_search tool |
| Browserbase | `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | `browserbase_service.ts`, browse_session_* |
| Creem (billing) | `CREEM_API_KEY` | `src/lib/creem.ts` |

A full list with descriptions is in `.env.example` at the repo root.

---

## Security controls

| Control | Implementation |
|---|---|
| Auth guard | `requireAuthenticatedUser()` on every server action and protected page |
| RLS | `workspace_memberships` enforced by Supabase on the cookie client |
| Admin client scope | Only Inngest functions, operator routes, scripts |
| SSRF prevention | `assertSafeUrl()` + `BLOCKED_HOSTNAMES` blocklist in `web_fetch` tool |
| MIME whitelist | `image/jpeg`, `image/png`, `image/webp`, `image/gif` only for uploads |
| Rate limiting | `src/lib/api/rate_limit.ts` — per-user / per-workspace limits on all AI endpoints |
| Write-role gate | `20260412000005_rls_write_role_gate.sql` — viewer role blocked from writes |

See `SECURITY.md` for the full threat model.

---

## Repo layout summary

```
/
├── src/
│   ├── app/            Next.js routes (pages + API)
│   ├── server/         Auth, domain, repositories, services
│   ├── lib/            Utility libraries (supabase clients, inngest, crdt, etc.)
│   └── components/     React UI components
├── supabase/
│   └── migrations/     91 ordered SQL migrations (applied via supabase db push)
├── scripts/            Deployment helper scripts
├── agent/              Modal operator harness (Python, separate deploy)
├── docs/               Per-subsystem documentation
├── CONTRIBUTING.md     Contributor guide
├── SECURITY.md         Security policy and threat model
└── .env.example        All required environment variables
```
