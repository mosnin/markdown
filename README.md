# Context Store

A structured, markdown-native context management system for humans and AI agents.

Context Store is not a generic notes app. It is an opinionated system for
capturing, organizing, and serving structured context — to yourself and to AI
agents — through a clear information hierarchy:
**workspaces → boxes → folders → notes / guides / bundles**.

---

## What it is

- **Deterministic retrieval** — context bundles assemble bounded, ranked note
  sets based on stable retrieval priorities and link structure. Same inputs,
  same output, every time.
- **Trust layer** — external AI connections propose writes; humans review and
  approve before anything changes in the knowledge base.
- **Version history** — every note mutation creates an immutable version
  snapshot. Rollback is a first-class operation.
- **Portability** — notes, folders, boxes, and context bundles can be exported
  as structured zip packages and re-imported with explicit collision behavior.
- **Audit log** — all workspace events are append-only with full actor and
  operation metadata.

---

## Local development

### Prerequisites

- Node.js 20+
- pnpm 10+
- A Supabase project (free tier works)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables and fill in values
cp .env.example .env.local

# 3. Apply database migrations
npx supabase link --project-ref <your-project-ref>
npx supabase db push

# 4. Start the dev server
pnpm dev
```

Open `http://localhost:3000` and sign in via magic link.

### Supabase configuration (one-time)

1. **Enable Email OTP** — Authentication → Providers → Email → enable "Email OTP"
2. **Add redirect URL** — Authentication → URL Configuration → Redirect URLs → add `http://localhost:3000/auth/callback`
3. **Set site URL** — Authentication → URL Configuration → Site URL → `http://localhost:3000`

---

## Available commands

| Command | Description |
|---|---|
| `pnpm dev` | Start local dev server with HMR |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | TypeScript type check (`tsc --noEmit`) |
| `pnpm test` | Run unit tests (vitest) |
| `pnpm test:watch` | Test watch mode |
| `pnpm test:coverage` | Tests with coverage report |
| `pnpm ci` | Full local CI: typecheck + lint + test + build |
| `pnpm mcp` | Run MCP server (requires `.env.mcp.local`) |
| `pnpm build:mcp` | Build compiled MCP server to `dist/mcp/` |

---

## MCP server

Context Store ships a standalone MCP server for AI agent integrations
(Claude, Cursor, etc.).

```bash
# Configure MCP environment
cp .env.example .env.mcp.local
# Fill in CONTEXT_STORE_API_BASE_URL and CONTEXT_STORE_CONNECTION_SECRET

# Run
set -a; source .env.mcp.local; set +a
pnpm mcp
```

See `docs/deployment_v1.md` for production MCP configuration.

---

## Documentation

| Document | Contents |
|---|---|
| `docs/architecture.md` | System architecture and module layout |
| `docs/deployment_v1.md` | Deployment guide (Vercel + Supabase) |
| `docs/production_readiness_v1.md` | Launch readiness checklist |
| `docs/security_notes_v1.md` | Security model and known risks |
| `docs/testing_strategy_v1.md` | Test strategy and coverage |
| `docs/canonical_api_v1.md` | External API reference |
| `docs/connections_v1.md` | External connection auth model |
| `docs/import_export_v1.md` | Import/export portability contract |
| `docs/context_bundle_v1.md` | Context bundle assembly |
| `docs/machine_write_v1.md` | Write proposals and generated notes |
| `docs/version_history_v1.md` | Version history and rollback |
| `docs/lifecycle_controls_v1.md` | Archive / trash / restore |
| `docs/v1_parity_report.md` | V1 acceptance criteria status |

---

## V1 launch status

Context Store V1 is **ready for private beta launch**.
See `docs/production_readiness_v1.md` for the full readiness assessment.
