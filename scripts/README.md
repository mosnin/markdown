# Deployment scripts

Pre-flight and one-shot helpers used when shipping Poggle to production.

## Scripts

### `deploy_check.ts`

Read-only pre-flight. Verifies required env vars, Supabase DB connectivity,
lists the migrations in `supabase/migrations/`, checks for the `note-images`
storage bucket, and (optionally) pings the Modal harness `/health`.

Exits non-zero if any check fails (warnings are non-fatal).

```
pnpm deploy:check
# or directly:
pnpm tsx scripts/deploy_check.ts
```

### `create_storage_bucket.ts`

Idempotent — creates the `note-images` Supabase Storage bucket if missing
(`public: true`). RLS policies must be applied separately via SQL migrations.

```
pnpm deploy:bucket
```

### `push_migrations.sh`

Bash wrapper around `supabase db push`. Prints the migration count, prompts
`Are you sure? Type 'yes' to continue:` (unless `$CI` is set), then runs
`supabase db push "$@"` and exits with its status code.

```
./scripts/push_migrations.sh
# non-interactive (CI):
CI=1 ./scripts/push_migrations.sh
# extra flags pass through:
./scripts/push_migrations.sh --dry-run
```

Requires the `supabase` CLI on `PATH`.

## Deployment order

1. `pnpm deploy:check` — pass before doing anything destructive.
2. `./scripts/push_migrations.sh` — apply new migrations to the target DB.
3. `pnpm deploy:bucket` — only if step 1 flagged the bucket missing.
4. Deploy Next.js (Vercel / self-hosted).
5. Redeploy the Modal workspace-operator harness (managed outside this repo).

## Environment loading

These scripts run outside Next.js, so `.env` is NOT auto-loaded. Either:

- Export the vars in your shell, or
- Prefix with `node --env-file=.env`, e.g.
  `node --env-file=.env node_modules/.bin/tsx scripts/deploy_check.ts`

`dotenv` is intentionally not a dependency.

## Notes

- `.env.example` at the repo root documents every var the app expects.
- `MODAL_BASE_URL` is optional — the deploy check only runs the Modal
  health probe when it's set.
