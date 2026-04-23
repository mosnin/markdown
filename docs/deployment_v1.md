# Deployment Guide — V1

Deployment target: **Vercel + Supabase**

---

## Prerequisites

- A Supabase project (free tier works for private beta)
- A Vercel account connected to your GitHub repo
- pnpm 10+ installed locally

---

## Step 1 — Set up Supabase

1. Create a new Supabase project at `https://supabase.com`

2. **Apply database migrations**

   From the project root:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   Or apply migrations manually: open the SQL editor in your Supabase dashboard
   and run each file in `supabase/migrations/` in filename order.

3. **Configure authentication**

   In the Supabase dashboard under Authentication → Providers → Email:
   - Enable Email OTP (magic link)
   - Optionally disable Email + Password if you only want magic links

4. **Add redirect URL allow-list**

   Authentication → URL Configuration → Redirect URLs:
   ```
   https://your-domain.vercel.app/auth/callback
   http://localhost:3000/auth/callback   (for local dev)
   ```

5. **Set Site URL**

   Authentication → URL Configuration → Site URL:
   ```
   https://your-domain.vercel.app
   ```

6. **Configure Storage bucket** (for export artifacts)

   The migration `supabase/migrations/20260409000010_export_artifacts_bucket.sql`
   creates the private `exports` bucket automatically when you apply migrations.
   Verify it appears in Storage → Buckets as a private bucket.

---

## Step 2 — Deploy to Vercel

1. Import the repository in the Vercel dashboard

2. Set **Framework Preset** to Next.js (auto-detected)

3. Set **Build Command** to `pnpm build` (or leave as auto-detected)

4. **Configure environment variables** in Vercel → Settings → Environment Variables:

   | Variable | Value | Required |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project.supabase.co` | Yes |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key from Supabase dashboard | Yes |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key from Supabase dashboard | Yes — mark as **Secret** |
   | `NEXT_PUBLIC_APP_URL` | `https://your-domain.vercel.app` | Yes |
   | `NEXT_PUBLIC_API_BASE_URL` | Same as `NEXT_PUBLIC_APP_URL` | No (used in Connections UI) |

   > **Security**: `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security.
   > Mark it as a Secret in Vercel. Never expose it in client-side code.

5. Deploy — Vercel will build and deploy automatically on push to the configured branch.

---

## Step 3 — Post-deployment verification

1. Visit `https://your-domain.vercel.app` and sign in via magic link
2. Create a workspace box and verify note creation
3. Create a connection in Settings → Connections and verify the bearer token works:
   ```bash
   curl -s https://your-domain.vercel.app/api/v1/boxes \
     -H "Authorization: Bearer csk_v1_<your-token>"
   ```
4. Test import by uploading a `.md` file from the Import section
5. Test export by exporting a box and downloading the zip
6. Verify audit log shows events for all operations above

---

## CI pipeline

The GitHub Actions workflow at `.github/workflows/ci.yml` runs on every push
and pull request:

```
type check → lint → unit tests → build
```

CI uses placeholder environment variable values for the build step — no real
Supabase credentials are needed in CI.

---

## MCP server deployment

The MCP server below is the **legacy stdio transport** — it runs on the AI
agent's machine, not on Vercel. Typical deployment:

1. Build the MCP binary:
   ```bash
   pnpm build:mcp
   # Output: dist/mcp/server.js
   ```

2. Configure your AI agent (Claude, Cursor, etc.) to run:
   ```json
   {
     "command": "node",
     "args": ["/path/to/dist/mcp/server.js"],
     "env": {
       "CONTEXT_STORE_API_BASE_URL": "https://your-domain.vercel.app",
       "CONTEXT_STORE_CONNECTION_SECRET": "csk_v1_your_secret_here",
       "CONTEXT_STORE_MCP_LOG_LEVEL": "info"
     }
   }
   ```

3. Alternatively, run directly without building:
   ```bash
   CONTEXT_STORE_API_BASE_URL=https://your-domain.vercel.app \
   CONTEXT_STORE_CONNECTION_SECRET=csk_v1_... \
   pnpm mcp
   ```

The MCP server logs to stderr only. No ports are opened. All data access goes
through the canonical API with the provided bearer token.

For connector-facing production integrations, prefer the OAuth 2.1 HTTP MCP
endpoint at `/api/mcp` (documented in `docs/mcp_v1.md` and
`docs/mcp_oauth_and_secure_connector_architecture_v1.md`).

---

## Database migrations

Migrations are in `supabase/migrations/` as numbered SQL files. Apply in order.

**Important**: Migrations use `IF NOT EXISTS` guards where appropriate and are
safe to re-apply. Always run the full migration set on a fresh project rather
than applying partial sets.

For production schema changes post-launch:
- Test migrations on a Supabase branch or staging project first
- Apply to production during low-traffic periods
- Verify RLS policies after any schema change

---

## Export artifact cleanup

Export artifacts live in the private `exports` Supabase Storage bucket.

### Stable resource-scoped paths (V1 strategy)

Export artifacts are stored at `{workspaceId}/{filename}` with `upsert: true`.
Re-exporting the same box **overwrites** the previous artifact, bounding storage
growth to **at most one artifact per named export resource**. Signed URLs still
expire after 1 hour; the underlying object persists until explicitly cleaned up.

### SQL cleanup function

Migration `supabase/migrations/20260409000012_export_artifact_cleanup.sql`
installs a cleanup function:

```sql
SELECT cleanup_old_export_artifacts(7);  -- delete artifacts older than 7 days
SELECT cleanup_old_export_artifacts();   -- uses 7-day default
```

### Recommended production schedule

Enable `pg_cron` in your Supabase project and add a weekly job:

```sql
SELECT cron.schedule(
  'weekly-export-cleanup',
  '0 3 * * 0',  -- 03:00 UTC every Sunday
  $$ SELECT cleanup_old_export_artifacts(7); $$
);
```

This can also be triggered from a Vercel Cron Job via an authenticated internal
route if you prefer to avoid direct DB access from the scheduler.

---

## Production environment summary

| Concern | Status |
|---|---|
| Database | Supabase managed Postgres with RLS |
| Auth | Supabase Auth (magic link) |
| File storage | Supabase Storage (private `exports` bucket) |
| Application hosting | Vercel (Next.js, serverless) |
| MCP server | Client-side stdio process (not hosted) |
| Rate limiting | In-process per instance — upgrade to Vercel KV for production scale |
| Monitoring | Vercel function logs + audit log in app |
| Secret management | Vercel environment variables (marked Secret) |

---

## Rollback

Vercel supports instant rollback to any previous deployment via the dashboard.

For database state, the audit log and version history provide a complete record.
Individual notes can be rolled back from the version history UI.

There is no database-level rollback in V1 beyond the note version history.
Schema changes are applied forward-only.

---

## Known deployment considerations

1. **Cold starts**: Vercel serverless functions have cold start latency.
   The app is designed to be stateless so cold starts are safe.

2. **Service role key scope**: The service role key is used in all
   `/api/v1/` routes and the import endpoint. If it is compromised, rotate it
   immediately in Supabase and update the Vercel environment variable.

3. **Export artifact cleanup**: V1 uses stable resource-scoped paths (one artifact
   per export name), bounding growth automatically. Schedule the SQL cleanup
   function for legacy artifact purge. See cleanup section above.

4. **Rate limiting**: The in-process rate limiter is suitable for private
   beta. For production scale with multiple instances, add Vercel KV.
