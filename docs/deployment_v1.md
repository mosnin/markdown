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

The MCP server is a **stdio process** — it runs on the AI agent's machine, not
on Vercel. Typical deployment:

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

Export artifacts accumulate in the `exports` Supabase Storage bucket.
Signed URLs expire after 1 hour but the underlying files are not deleted.

**V1 expectation**: Manual cleanup or a scheduled Supabase Edge Function that
deletes objects older than 24 hours. This is not implemented in V1 but is
straightforward to add:

```sql
-- Run as a scheduled job or edge function
DELETE FROM storage.objects
WHERE bucket_id = 'exports'
  AND created_at < now() - interval '24 hours';
```

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

3. **Export artifact accumulation**: Plan a cleanup job before significant
   usage. See cleanup section above.

4. **Rate limiting**: The in-process rate limiter is suitable for private
   beta. For production scale with multiple instances, add Vercel KV.
