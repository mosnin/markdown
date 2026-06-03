# Launch checklist — the one-loop minimal deploy

The goal of this runbook is a **functional** deploy of the core loop: a stranger
can sign up, **connect an agent over MCP**, the agent **reads context** and files
a **write proposal**, a human **approves it** in AI Edits, then hits a plan limit
and **pays**. Everything else is out of scope for first revenue.

This is the Phase-1 (infrastructure) runbook. It is grounded in the actual code:
`src/lib/env.ts` (required-env contract), `src/lib/canonical_url.ts` (OAuth/MCP
issuer resolution), the Creem billing routes under `src/app/api/billing/`, and
`supabase/migrations/`. Where this disagrees with older docs, trust this file and
the code.

> **Status:** the app already **builds and deploys** (Vercel preview is wired and
> green). What's missing is real backing services + env. This checklist fills
> exactly that gap.

---

## 0. Prerequisites

- Node 20+, `pnpm` 10+, Supabase CLI.
- Accounts: **Supabase**, **OpenAI** (or any OpenAI-compatible endpoint),
  **Creem** (billing). A **domain** (or just use the Vercel production URL).

---

## 1. Supabase (data + auth + storage)

1. Create a Supabase project.
2. Apply the schema (it is authoritative in `supabase/migrations/`):
   ```bash
   supabase link --project-ref <your-ref>
   pnpm deploy:migrations      # wraps `supabase db push` with a confirm prompt
   ```
3. Storage buckets: `exports` is created by a migration; create `note-images`:
   ```bash
   pnpm deploy:bucket          # idempotent create of the note-images bucket
   ```

> ⚠️ **Biggest single risk in the whole launch:** these migrations have never
> been applied to a fresh project end-to-end. Do this step **first** and watch
> for failures before touching anything else.

---

## 2. Environment variables

### Required — the app refuses to boot without these (`REQUIRED_SERVER_ENV`)
| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (also used server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; bypasses RLS — never expose to the client |
| `NEXT_PUBLIC_APP_URL` | Your deployed origin (auth callbacks) |

### Required for the *loop* to actually work
| Var | Powers |
|---|---|
| `NEXT_PUBLIC_CANONICAL_URL` | The OAuth/MCP **issuer** (`getCanonicalBaseUrl`). Connectors cross-check this during discovery — set it to your real public origin or the MCP connect flow breaks on preview URLs. |
| `OPENAI_API_KEY` + `EMBEDDING_API_KEY` | `semantic_search`, `get_context_bundle`, KG extraction. The app degrades to keyword FTS without them, but agent context quality depends on these. (`EMBEDDING_API_BASE_URL` optional, defaults to OpenAI.) |
| `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_PRO_PRODUCT_ID`, `CREEM_BUSINESS_PRODUCT_ID` | The paywall — checkout, plan-flip webhook, portal. |

### Recommended in production (warn-only; safe defaults — `RECOMMENDED_SERVER_ENV`)
`NEXT_PUBLIC_SENTRY_DSN`, `WEBAUTHN_RP_ID` (+ `WEBAUTHN_RP_NAME` for passkeys),
`BRANCH_CLEANUP_CRON_TOKEN`.

### Leave UNSET for the MVP (off the one-loop path — cut-list features)
`WORKSPACE_OPERATOR_ENABLED` / `WORKSPACE_OPERATOR_URL` / `WORKSPACE_OPERATOR_SHARED_SECRET`
(Modal agent), `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` (triggers/workflows),
`EXA_API_KEY` / `TAVILY_API_KEY` / `BROWSERBASE_API_KEY` (web research),
`NEXT_PUBLIC_DIFF_WORKER_URL` / `NEXT_PUBLIC_BUNDLE_CACHE_URL` (Cloudflare workers).

See `.env.example` for the complete annotated list.

---

## 3. OAuth / MCP — no extra config

Discovery is automatic once `NEXT_PUBLIC_CANONICAL_URL` is your real origin:
- `/.well-known/oauth-authorization-server` (RFC 8414)
- `/.well-known/mcp-server`
- MCP endpoint: `${CANONICAL_URL}/api/mcp` (serves RFC 9728 protected-resource metadata)

The in-app **Connect agent** page (`/app/connect`) surfaces this URL to users with
copy-paste client config. Clients dynamically register (`/api/oauth/register`) and
the user approves consent at `/oauth/authorize` — no manual client setup required.

---

## 4. Creem (billing)

1. Create **Pro** and **Business** products → set `CREEM_PRO_PRODUCT_ID` /
   `CREEM_BUSINESS_PRODUCT_ID`.
2. Configure the webhook endpoint → `${APP_URL}/api/billing/webhook`, set
   `CREEM_WEBHOOK_SECRET`.
3. In **test mode**, run a checkout and confirm the workspace plan flips (this is
   the money path — budget real time to verify it).

---

## 5. Deploy (Vercel — already connected)

- The repo is already wired to a Vercel project (preview deploys are green).
- Set every variable from §2 in the Vercel project for **Production** and
  **Preview**.
- Point your domain at the project, then set `NEXT_PUBLIC_APP_URL` and
  `NEXT_PUBLIC_CANONICAL_URL` to that domain.

---

## 6. Verify

```bash
pnpm deploy:check        # scripts/deploy_check.ts — env / DB / bucket pre-flight probe
```

Then walk the loop on the live domain (the definition of "sellable"):

1. Sign up → workspace bootstrap.
2. Open **Connect agent** (`/app/connect`) → add the MCP URL to a client
   (Claude Desktop / Cursor).
3. Approve the OAuth consent.
4. Agent reads context and files a proposal.
5. Approve it in **AI Edits** (`/app/proposals`) → see the new version.
6. Hit a plan limit → Creem checkout → plan updates → keep working.

If all six work end-to-end on the domain, the loop is sellable.

---

## What this does NOT cover (Phase 4–5)

Marketing-site collapse + a single-story landing page, the in-app
home→Connect-agent funnel, a seeded sample Box for first-run, support channel,
and flipping Creem to live mode. Those come after the loop is functional.
