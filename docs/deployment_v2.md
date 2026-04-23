# Deployment Runbook — v2

End-to-end guide for deploying Poggle to production. There are four deployment targets:

1. **Supabase** — Postgres schema, RLS, storage bucket
2. **Next.js** — Vercel (primary) or self-hosted
3. **Inngest** — cloud background-function runner (no deploy step; auto-registers on startup)
4. **Modal operator harness** — Python long-running agent executor (separate deploy)

---

## Pre-flight checklist

Run this before every deploy:

```bash
# Requires all env vars to be exported (or use --env-file):
pnpm deploy:check
# or:
node --env-file=.env node_modules/.bin/tsx scripts/deploy_check.ts
```

The script (`scripts/deploy_check.ts`) verifies:

1. All required env vars are set (see table below).
2. Supabase DB is reachable (SELECT from `workspaces`).
3. `supabase/migrations/*.sql` files are listed (informational).
4. Inngest credentials present.
5. `note-images` storage bucket exists.
6. Modal harness `/health` endpoint (only if `MODAL_BASE_URL` is set).

Exit 1 on any fatal check. Warnings (`⚠`) are non-fatal.

---

## Environment variables

Set these in Vercel (or your hosting platform) and in the Modal secret. See `.env.example` at the repo root for descriptions.

### Required in production

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All layers |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Inngest fns, scripts, operator routes |
| `NEXT_PUBLIC_APP_URL` | Auth callbacks, share links |
| `OPENAI_API_KEY` | Voice transcription, workflow LLM calls |
| `EMBEDDING_API_KEY` | Semantic search, image description, KG extraction |
| `INNGEST_SIGNING_KEY` | Inngest webhook verification |
| `INNGEST_EVENT_KEY` | Inngest event publishing |
| `SHARE_SECRET` | HMAC-signed share tokens |
| `WORKSPACE_OPERATOR_SHARED_SECRET` | Next.js ↔ Modal auth header |
| `WEBAUTHN_RP_ID` | WebAuthn passkey relying party (production domain, no scheme) |
| `WEBAUTHN_RP_NAME` | WebAuthn passkey display name |

### Required for optional features

| Variable | Feature | Notes |
|---|---|---|
| `WORKSPACE_OPERATOR_URL` | AI agent | Modal endpoint `/invoke` URL |
| `WORKSPACE_OPERATOR_ENABLED` | AI agent | Set to `"true"` to enable |
| `EXA_API_KEY` | Deep search | Exa neural search |
| `BROWSERBASE_API_KEY` | Stateful browsing | |
| `BROWSERBASE_PROJECT_ID` | Stateful browsing | |
| `CREEM_API_KEY` | Billing | |
| `CREEM_WEBHOOK_SECRET` | Billing webhooks | |
| `CREEM_PRO_PRODUCT_ID` | Billing | |
| `CREEM_BUSINESS_PRODUCT_ID` | Billing | |
| `NEXT_PUBLIC_SENTRY_DSN` | Error tracking | Omit to disable Sentry |
| `MODAL_BASE_URL` | Deploy check | Used only by `scripts/deploy_check.ts` |
| `EMBEDDING_API_BASE_URL` | Embeddings | Defaults to `https://api.openai.com/v1` |

---

## Deployment order

Follow these steps in order. Do not skip to step 4 before steps 1–3 pass.

### Step 1 — Run pre-flight

```bash
pnpm deploy:check
```

All checks must pass before proceeding. Fix any `✗` items first.

### Step 2 — Push DB migrations

```bash
./scripts/push_migrations.sh
# CI/non-interactive:
CI=1 ./scripts/push_migrations.sh
# dry run:
./scripts/push_migrations.sh --dry-run
```

The script counts the `.sql` files, prompts for confirmation (skipped when `$CI` is set), then runs `supabase db push`. Requires the `supabase` CLI on `PATH`.

To install the Supabase CLI:
```bash
brew install supabase/tap/supabase
# or: npm install -g supabase
```

### Step 3 — Create storage bucket (first deploy only)

If `deploy:check` reported the `note-images` bucket missing:

```bash
pnpm deploy:bucket
# or:
pnpm tsx scripts/create_storage_bucket.ts
```

This is idempotent — safe to run even if the bucket already exists. RLS policies are applied via SQL migrations, not this script.

### Step 4 — Deploy Next.js

**Vercel (recommended):**

```bash
vercel deploy --prod
```

Or push to the branch connected to the Vercel project. Vercel auto-runs the Next.js build.

**Self-hosted:**

```bash
pnpm build
pnpm start
```

Requires Node 20+. Set `PORT` to override the default 3000.

After deploy, the Inngest endpoint at `/api/inngest` auto-registers functions with the Inngest cloud on the first request. No manual step needed.

### Step 5 — Deploy the Modal operator harness

The harness lives in `agent/` and is deployed separately. See `agent/DEPLOY.md` for the full runbook. Summary:

```bash
# First time only: create the Modal secret
modal secret create poggle-operator-secrets \
  --env production \
  POGGLE_BASE_URL='https://your-app.vercel.app' \
  WORKSPACE_OPERATOR_SHARED_SECRET='<same-value-as-next-js-env>' \
  OPENAI_API_KEY='sk-...'

# Deploy:
MODAL_ENVIRONMENT=production bash agent/scripts/deploy_staging.sh
```

After deploy, copy the `/invoke` URL from Modal's output and set it as `WORKSPACE_OPERATOR_URL` in the Next.js environment, then redeploy Next.js (or update the env var without a redeploy, depending on your hosting).

---

## Rollback procedures

### Next.js rollback

**Vercel:** Use the Vercel dashboard → Deployments → select a previous deployment → "Promote to Production".

**Self-hosted:** Redeploy the previous git SHA:
```bash
git checkout <previous-sha>
pnpm build && pnpm start
```

### DB migration rollback

Supabase does not support automatic down-migrations. To undo a migration:

1. Write a corrective migration (e.g. `20260429000001_revert_xyz.sql`) that reverses the change.
2. Push it with `./scripts/push_migrations.sh`.

Never delete a migration file that has already been pushed — it will cause `supabase db push` to fail.

### Modal operator rollback

```bash
# Stop the running app immediately:
modal app stop poggle-workspace-operator --env production

# Redeploy a previous git ref:
git checkout <previous-good-sha>
MODAL_ENVIRONMENT=production bash agent/scripts/deploy_staging.sh
git checkout -
```

Stopping the app causes the Next.js server action to receive 5xx and surface an "agent unavailable" error to users, but does not lose data.

---

## Verifying a production deploy

After all steps complete:

1. Open the app and sign in.
2. Create a note and type a few words — verify autosave writes to the DB.
3. If Pog is enabled: open the conversation panel and send a message — verify the operator run appears in `/app/workspace_operator`.
4. Open `/app/usage` — verify the usage dashboard loads (Supabase + aggregation queries).
5. Run `pnpm deploy:check` against the production env vars — all checks should pass.

---

## Inngest

Inngest functions are auto-registered at `/api/inngest` on startup. No CLI deploy step is required.

In production, the Inngest cloud dashboard at `app.inngest.com` shows:
- Registered functions and their event triggers
- Queued, running, and completed function runs
- Failed runs with stack traces

If functions are not appearing after deploy: navigate to `https://your-app.vercel.app/api/inngest` in a browser — Inngest's registration check re-triggers on GET.

---

## Scripts reference

| Command | Script | Description |
|---|---|---|
| `pnpm deploy:check` | `scripts/deploy_check.ts` | Read-only pre-flight; exits non-zero on failure |
| `pnpm deploy:bucket` | `scripts/create_storage_bucket.ts` | Create `note-images` bucket (idempotent) |
| `./scripts/push_migrations.sh` | `scripts/push_migrations.sh` | Confirm + run `supabase db push` |
| `CI=1 ./scripts/push_migrations.sh` | | Same, non-interactive |

All scripts run outside Next.js. Either export env vars in the shell or prefix with `node --env-file=.env`.
