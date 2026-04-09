# Supabase

SQL migration files for Context Store. These are applied to a Supabase (Postgres) project using the Supabase CLI or dashboard SQL editor.

## Applying migrations

### Via Supabase CLI (recommended for local dev)

```bash
supabase db push
```

Or link and push to a remote project:

```bash
supabase link --project-ref your-project-ref
supabase db push
```

### Via Supabase dashboard

Open **SQL Editor** in your project dashboard and run the migration files in numeric order.

## Migration files

| File | Purpose |
|---|---|
| `20260409000001_core_schema.sql` | Core tables, helper functions, indexes, triggers |
| `20260409000002_rls_policies.sql` | Row Level Security: enable + policies for single-owner V1 |

## Conventions

- All timestamps are `timestamptz`.
- All primary keys are `uuid` using `gen_random_uuid()`.
- Enums are `text` columns with `CHECK` constraints — no Postgres enum types.
- Soft delete is the default for content tables (status = 'trashed').
- Audit events and note versions are append-only and immutable.
- `updated_at` is maintained by the `set_updated_at()` trigger.

## RLS model

V1 is single-owner. Each workspace is owned by one `auth.users` record.
All child tables (boxes, folders, notes, etc.) derive access from workspace ownership.
Connection token authorization is NOT handled via RLS in V1 — it is enforced
by the API layer.

See `docs/data_model.md` and `docs/auth.md` for full detail.
