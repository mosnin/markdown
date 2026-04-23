# Poggle

A workspace for notes and AI agents. Poggle combines a realtime markdown note
editor, a typed object model (boxes → folders → notes / files / skills /
agents), a visual workflow builder, entity-centric knowledge graph retrieval,
and a durable agent runtime that can take actions on your workspace.

The app is a Next.js App Router project backed by Supabase (Postgres + Auth +
Storage + Realtime), with long-running work offloaded to Inngest and Modal.

---

## What's in the box

Feature areas that are implemented in this repo (see the subsystem map in
`docs/architecture.md` for the files behind each one):

- **Notes with CRDT editor** — CodeMirror 6 + Yjs via the Supabase Realtime
  transport for multi-tab / multi-cursor editing with autosave
  (`src/components/product/note_crdt_editor.tsx`,
  `src/lib/crdt/supabase_yjs_provider.ts`).
- **Object model** — notes, files, skills, agents, folders all live in
  `workspace_objects` with shared versioning, lifecycle, links, and import /
  export.
- **Knowledge graph** — entities and edges extracted from notes; GraphRAG
  retrieval blends vector search with one-hop entity traversal
  (`src/server/services/knowledge_graph_service.ts`,
  `src/server/services/graph_rag_service.ts`).
- **Agents + triggers** — workspace-level agents run via the Modal Python
  harness; triggers fire on manual, `note_created`, `note_updated`, or cron
  schedules (`src/server/domain/types/agent.ts`,
  `supabase/migrations/20260422000002_agent_triggers.sql`).
- **Sub-agents** — disposable per-task agent sessions launched from the main
  agent loop or from inline slash-commands
  (`src/server/domain/types/subagent.ts`,
  `supabase/migrations/20260425000001_subagents.sql`).
- **Workflows** — DAG builder on `@xyflow/react`; executed by Inngest with
  topological level-by-level evaluation
  (`src/components/product/workflow_canvas.tsx`,
  `src/lib/inngest/functions/execute_workflow.ts`).
- **Web research** — Exa deep search, Tavily keyword search, and Browserbase
  stateful browsing sessions, all gated by a per-workspace monthly budget
  (`src/app/api/agent/tools/`).
- **Inline slash-commands** — `/summarize`, `/expand`, `/translate`, `/cite`,
  `/outline`, `/rewrite` inside the note editor, plus user-defined skill
  sub-agents (`src/server/domain/types/inline_command.ts`,
  `src/components/product/slash_command_menu.tsx`).
- **Voice + image input** — Whisper transcription for voice notes, paste-to-
  upload images with GPT-4o description
  (`src/app/api/voice/transcribe/route.ts`,
  `src/app/app/notes/image_actions.ts`).
- **Usage dashboard** — per-workspace spend across operator runs, sub-agents,
  workflows, and inline commands (`src/app/app/usage/page.tsx`,
  `src/server/services/usage_summary_service.ts`).
- **MCP** — OAuth 2.1 + PKCE HTTP MCP endpoint at `/api/mcp`, plus a legacy
  stdio MCP server (`pnpm mcp`) for local connectors
  (`src/app/api/mcp/route.ts`, `src/server/mcp/`).
- **Canonical HTTP API** — versioned JSON API under `/api/v1` (`src/app/api/v1/`).
- **Auth** — Supabase Auth with passkeys (WebAuthn) and email-based sign-in
  (`src/app/sign_in/`, `src/app/api/auth/webauthn/`).
- **Billing** — Creem-backed subscription tier with a Pro and Business plan
  (`src/app/api/billing/`).

---

## Tech stack

Versions pulled from `package.json`:

| Layer | What we use |
|---|---|
| Framework | Next.js 16.2.3 (App Router), React 19.2.4 |
| Language | TypeScript 5.x |
| Database / auth / storage / realtime | Supabase (`@supabase/supabase-js` 2.102, `@supabase/ssr` 0.10) |
| Editor | CodeMirror 6 (`@codemirror/*`, `@uiw/react-codemirror` 4.25), Yjs 13 + `y-codemirror.next` |
| Graph / flow UI | `@xyflow/react` 12, `@dagrejs/dagre` 3 |
| Tree UI | `react-arborist` 3 |
| Styling | Tailwind CSS 4, shadcn v4 (Base UI, not Radix) |
| Workflows / cron | Inngest 3 |
| Python agent harness | Modal, OpenAI Agents SDK (see `agent/`) |
| Search | Postgres full-text search, pgvector (via `20260415000001_semantic_search.sql`) |
| Validation | Zod 4 |
| Web research | Exa (`exa-js` 1.5), Tavily (HTTP), Browserbase (`@browserbasehq/sdk`) |
| Rate limiting | Upstash Redis (`@upstash/ratelimit`, `@upstash/redis`) |
| Billing | Creem (`creem`, `@creem_io/nextjs`) |
| Error tracking | Sentry (`@sentry/nextjs`) |
| Auth MFA | `@simplewebauthn/browser` + `@simplewebauthn/server` |
| MCP | `@modelcontextprotocol/sdk` |
| Edge workers | Cloudflare Workers (`workers/diff-worker/`, `workers/bundle-cache-worker/`) |

---

## Quick start

Prerequisites:

- Node.js 20+
- `pnpm` 10+
- Supabase CLI (for local / remote DB)
- A Supabase project (remote or local)

```bash
# Install
pnpm install

# Copy env template and fill in values
cp .env.example .env.local

# Apply migrations to your target Supabase project
supabase link --project-ref <your-project-ref>
supabase db push

# Run the dev server
pnpm dev
```

Open `http://localhost:3000`.

All required and optional environment variables are documented in
`.env.example` at the repo root. Don't commit secrets.

### Supabase Storage buckets

Two buckets are used: `exports` (export packages, created by a migration)
and `note-images` (paste-to-upload image attachments, created by
`pnpm deploy:bucket` or a matching migration). See `scripts/README.md`.

### Optional services

These are all off by default and the app degrades gracefully when unset:

- `OPENAI_API_KEY` — required for voice transcription, workflow transform
  nodes, and knowledge-graph entity extraction.
- `EXA_API_KEY`, `TAVILY_API_KEY`, `BROWSERBASE_API_KEY` — web research tools.
- `WORKSPACE_OPERATOR_URL` + `WORKSPACE_OPERATOR_SHARED_SECRET` — Modal agent
  harness (set `WORKSPACE_OPERATOR_ENABLED=true` to turn it on).
- `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` — durable workflow + cron.
- `EMBEDDING_API_KEY` — semantic search; when absent, embedding operations
  no-op and keyword FTS remains.
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — rate limiting.
- `CREEM_API_KEY` — billing.
- `NEXT_PUBLIC_DIFF_WORKER_URL` + `NEXT_PUBLIC_BUNDLE_CACHE_URL` — Cloudflare
  edge workers for diffs and bundle cache.

---

## Available scripts

From `package.json`:

| Script | What it runs |
|---|---|
| `pnpm dev` | `next dev` — local dev server with HMR |
| `pnpm build` | `next build` — production build |
| `pnpm start` | `next start` — serve the production build |
| `pnpm lint` | `eslint` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run` — unit tests |
| `pnpm test:watch` | `vitest` — watch mode |
| `pnpm test:coverage` | `vitest run --coverage` |
| `pnpm test:e2e` | `playwright test` (see `e2e/`) |
| `pnpm ci` | `typecheck && lint && test && build` — full local CI |
| `pnpm mcp` | `tsx src/server/mcp/index.ts` — run the stdio MCP server |
| `pnpm build:mcp` | compile the stdio MCP server to `dist/mcp/` |
| `pnpm workers:dev` | run both Cloudflare workers locally via `wrangler dev` |
| `pnpm workers:deploy` | deploy both Cloudflare workers via `wrangler deploy` |
| `pnpm deploy:check` | `tsx scripts/deploy_check.ts` — pre-flight env / DB / bucket / Modal probe |
| `pnpm deploy:bucket` | `tsx scripts/create_storage_bucket.ts` — idempotent `note-images` bucket creation |
| `pnpm deploy:migrations` | `bash scripts/push_migrations.sh` — wrapped `supabase db push` with a confirm prompt |

---

## Deployment

Poggle has four moving pieces that deploy independently:

1. **Next.js app** — the web UI, API routes, server actions, MCP HTTP
   endpoint, and Inngest webhook receiver. Deployed to Vercel or any Node
   host that supports Next.js 16.
2. **Supabase** — Postgres (with RLS), Auth, Storage (`exports` +
   `note-images`), Realtime (used by the Yjs CRDT provider). Migrations in
   `supabase/migrations/` are applied with `pnpm deploy:migrations`.
3. **Inngest** — durable workflows + cron. Signs webhooks back into the Next.js
   app at `/api/inngest`. Registered functions live in
   `src/lib/inngest/functions/`.
4. **Modal** — Python Workspace Operator agent harness (main agent + sub-agent
   runtime). Source lives in `agent/`. Deploys independently; the Next.js side
   points at it via `WORKSPACE_OPERATOR_URL` + a shared secret.

Optional: two Cloudflare workers in `workers/` (diff + bundle cache), deployed
via `pnpm workers:deploy`.

<!-- TODO: verify — docs/deployment_v1.md exists but Team D is writing a new
     docs/deployment.md that supersedes parts of it. Both are listed below. -->

See `docs/deployment_v1.md` (current) and `docs/deployment.md` (in progress,
being written by another agent) for the deployment playbook.
`agent/DEPLOY.md` documents the Modal side.

---

## Repo layout

| Path | Contents |
|---|---|
| `src/app/` | Next.js App Router — pages, API routes, server actions. Marketing under `(marketing)/`, authenticated product under `app/`, admin under `admin/`. |
| `src/components/` | `ui/` (shadcn primitives, do not edit directly) and `product/` (Poggle product components). |
| `src/server/` | Server-only modules: `auth/`, `domain/` (types, constants, schemas), `repositories/`, `services/`, `mcp/`, `policies/`, `resolvers/`. |
| `src/lib/` | Shared libs usable from client or server: `supabase/` clients, `crdt/` Yjs provider, `inngest/` functions and client, `api/` response + rate limit, `embedding/`, `templates/`, `hooks/`. |
| `src/hooks/` | React hooks used by client components (voice recorder, image paste, embeddings, operator run stream). |
| `supabase/migrations/` | Chronological SQL migrations. Schema is authoritative here. |
| `scripts/` | Deployment helpers (`deploy_check.ts`, `create_storage_bucket.ts`, `push_migrations.sh`). |
| `agent/` | Python Workspace Operator (Modal) — OpenAI Agents SDK + tool callbacks. |
| `workers/` | Cloudflare workers — `diff-worker/` (edge diff compute) and `bundle-cache-worker/` (context bundle cache). |
| `e2e/` | Playwright end-to-end tests. |
| `docs/` | Design docs, architecture overview, schema / feature specs. See index below. |

---

## Documentation index

### Architecture and data model

| File | Topic |
|---|---|
| `docs/architecture.md` | System architecture overview (this is the map) |
| `docs/data_model.md` | Core schema — workspaces, boxes, folders, notes |
| `docs/auth.md` | Auth architecture (Supabase session + `RequestContext`) |
| `docs/auth_and_permissions.md` | Workspace memberships, roles, RLS gating |
| `docs/design_system.md` | shadcn v4 / Tailwind v4 / Base UI conventions |

### Product features (current)

| File | Topic |
|---|---|
| `docs/workflows_v1.md` | Visual workflow builder + Inngest execution |
| `docs/web_agents_v1.md` | Exa / Tavily / Browserbase research tools + budget |
| `docs/knowledge_graph_v1.md` | Entity extraction + GraphRAG retrieval |
| `docs/subagents_v1.md` | Sub-agent fan-out from operator + inline commands |
| `docs/streaming_and_inline_ai_v1.md` | SSE streaming + `/command` slash menu |
| `docs/automation_v1.md` | Agent triggers (manual / note / schedule) via Inngest |
| `docs/graph_view_v1.md` | Workspace graph view (`@xyflow/react`) |
| `docs/modal_agent.md` | Python Workspace Operator on Modal |

### AI / agent integration

| File | Topic |
|---|---|
| `docs/mcp_v1.md` | Stdio MCP server (12 tools, canonical API proxy) |
| `docs/mcp_oauth_and_secure_connector_architecture_v1.md` | HTTP MCP + OAuth 2.1 + PKCE |
| `docs/mcp_oauth_product_surface_and_token_lifecycle_v1.md` | Connected apps UI + consent lifecycle |
| `docs/mcp_auth_architecture_foundation_v1.md` | Bearer + scope foundation |
| `docs/canonical_api_v1.md` | Versioned HTTP API (`/api/v1`) |
| `docs/connections_v1.md` | Legacy connection-secret auth model |
| `docs/machine_write_v1.md` | Write proposals and generated notes |

### Object model, versioning, trust

| File | Topic |
|---|---|
| `docs/object_model_expansion_v1.md` | Notes → notes + files + skills + agents |
| `docs/agents_object_and_editor_v1.md` | Agent object surface |
| `docs/files_object_and_editor_v1.md` | File object surface |
| `docs/skills_object_and_editor_v1.md` | Skill object surface |
| `docs/expanded_object_trust_model_v1.md` | Trust + proposal rules across types |
| `docs/version_history_v1.md` | Immutable version chain + rollback |
| `docs/lifecycle_controls_v1.md` | Archive / trash / restore |
| `docs/rollback_architecture_v1.md` | Change-sets + structural events |
| `docs/rollback_schema_and_restore_engine_v1.md` | Concrete restore engine |
| `docs/reusable_attach_and_reference_model_v1.md` | Workspace-reusable attach model |

### Branching

| File | Topic |
|---|---|
| `docs/branch_aware_writes_v1.md` | Per-object branch write contracts |
| `docs/branch_local_structural_creation_v1.md` | Branch-local new objects |
| `docs/branch_local_sort_order_and_reorder_isolation_v1.md` | Sort order on branches |
| `docs/branch_promotion_gates_v1.md` | Promotion gates + reviews |
| `docs/branch_rls_hardening_v1.md` | Branch RLS |
| `docs/package_branch_state_for_skills_and_agents_v1.md` | Package metadata on branches |

### New feature docs (in progress — landing in parallel with this rewrite)

<!-- TODO: verify — these files are being written by other agents. -->

| File | Topic |
|---|---|
| `docs/voice_transcription.md` | Whisper endpoint + `use_voice_recorder` hook |
| `docs/image_attachments.md` | Paste-to-upload + GPT-4o description |
| `docs/inline_commands.md` | `/command` slash menu implementation |
| `docs/usage_dashboard.md` | Per-workspace usage + cost dashboard |
| `docs/deployment.md` | Updated deployment playbook |
| `docs/migrations.md` | Migration authoring + ordering rules |

### Operations and hardening

| File | Topic |
|---|---|
| `docs/deployment_v1.md` | Current deployment guide |
| `docs/testing_strategy_v1.md` | Unit / integration / e2e strategy |
| `docs/production_readiness_v1.md` | Pre-GA readiness checklist |
| `docs/security_notes_v1.md` | Known security considerations |
| `docs/hardening_v1.md` | Phase 4 hardening changes |
| `docs/cloudflare_workers_v1.md` | Diff + bundle-cache edge workers |
| `docs/local_embeddings_v1.md` | Embedding provider + fallback |
| `docs/retrieval_layer_v1.md` | Retrieval architecture |

### Portability

| File | Topic |
|---|---|
| `docs/import_export_v1.md` | Manifest v1.0 (notes + folders + boxes + bundles) |
| `docs/contextual_import_export_v1.md` | Manifest v1.1 (files / skills / agents) |
| `docs/contextual_import_flows_v1.md` | Box / folder / note-level import surfaces |
| `docs/portability_contract_correction_v1.md` | Schema fixes |

### Historical design specs

The rest of `docs/*_v1.md` and related files are historical per-phase design
specs kept for traceability (accessibility, onboarding, mobile nav,
workspace selector, release-candidate reports, context bundle, trust
surface, vocabulary normalisation, etc.). Start with `docs/architecture.md`
and follow links from there.

---

## Contributing

<!-- TODO: verify — CONTRIBUTING.md is being created by another agent
     (Team D). Link once it lands. -->

A `CONTRIBUTING.md` is being added in a parallel branch. Until then: open
issues for bugs, use `pnpm ci` before submitting patches, and match the
existing `snake_case` file naming in `src/components/product/` and
`src/server/`.

---

## License

No `LICENSE` file is present at the repo root. Treat the source as
proprietary unless and until one is added.
