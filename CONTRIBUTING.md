# Contributing

Thanks for taking the time to contribute. This repo is an actively evolving Next.js 16 + React 19 + Supabase app, and the conventions below exist to keep the codebase coherent as it grows. Please skim the whole document before opening your first PR — a few of the rules (Next.js 16 `params` awaiting, React 19 lint constraints, append-only migrations) are easy to trip over if you are coming from older Next.js or React training data.

## Development setup

See the quick-start in [`README.md`](./README.md) for cloning, environment variables, and running the app locally. Copy `.env.example` to `.env.local` and fill in the values before booting `pnpm dev`. Don't duplicate the setup steps here — treat the README as the source of truth.

## Branch and commit conventions

- Branch off `main` for all work. Name branches after the slice of work, e.g. `phase-13a-foo`, `fix/schedule-dialog-escape`, `docs/contributing`.
- Keep commit subjects in the imperative mood and reasonably specific. Match the style of recent history, for example:
  - `Phase 12B — deployment readiness scripts (pre-flight, bucket, migrations)`
  - `Phase 11 audit fixes — orphan trigger cleanup + Escape-close on schedule dialog`
  - `Docs — rewrite README and add voice/image feature references`
- Use the commit body to explain the "why" — what problem you are solving, what trade-offs you made, what you deliberately did not do. The diff already shows the "what".
- Prefer a small number of meaningful commits over a long chain of `wip` commits. Squash locally before opening a PR if needed.

## Pre-PR checklist

Before opening or updating a PR, run the full CI pipeline locally:

```bash
pnpm ci   # typecheck && lint && test && build
```

For any change that touches UI, server actions reached from the UI, or auth flows, also run:

```bash
pnpm test:e2e   # Playwright suite in e2e/
```

Do not merge a PR without a green `pnpm ci`. If Playwright is flaky for your change, fix the flake or quarantine the test with a clearly-scoped `TODO` — don't just retry until it passes.

If your change affects deployment (env vars, buckets, migrations), also run `pnpm deploy:check` and include the output in the PR description.

## Code style

### Next.js 16

- This is Next.js 16, not 13/14. `params` and `searchParams` in server components, route handlers, and `generateMetadata` are **Promises** — always `await` them. The same applies to `cookies()` and `headers()`. When in doubt, read the matching guide under `node_modules/next/dist/docs/` before writing new code.
- Heed deprecation notices surfaced at build time; don't silence them.

### React 19 lint rules

The `eslint-config-next` + React 19 rules are strict about effects and refs:

- **No `setState` inside a `useEffect` body** purely to derive state from props. Use the derived-state-during-render pattern instead:

  ```ts
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setOther(/* ... */);
  }
  ```

- **No `useRef` access during render.** Read/write refs from event handlers or effects, not from the render body.
- If the linter complains, fix the code — do not disable the rule.

### Server actions

- Server actions live in `"use server"` files under `src/app/app/**/actions.ts`. Don't scatter them elsewhere.
- Every server action must call `requireAuthenticatedUser()` and verify workspace ownership **before** any DB write.
- `createAdminClient` is banned from user-facing server actions. It is only for Inngest functions and background scripts that run outside of a user session.

### Repositories

- Repositories in `src/server/repositories/` accept a `SupabaseClient` as their first argument. Callers pick session-scoped vs. admin — repositories never decide for them.

### File naming

- Use `snake_case` for file names to match existing convention in `src/components/product/` (e.g. `active_branch_banner.tsx`) and `src/server/`. React components themselves stay `PascalCase`; only the filename is `snake_case`.

## Migrations

- Migrations live in `supabase/migrations/` and are **append-only in git**. Never edit or delete a migration that has landed on `main` — write a new one that corrects it.
- Filename pattern: `YYYYMMDDhhmmss_snake_description.sql` (e.g. `20260428000001_workflow_schedule_triggers.sql`).
- Use `IF NOT EXISTS` / `IF EXISTS` guards so re-runs are safe.
- Any new workspace-scoped table must have RLS enabled and a policy that checks workspace membership. Don't rely on application code alone.
- Apply with `pnpm deploy:migrations` against the appropriate environment.

## Testing

- Unit tests run via Vitest alongside the code they cover; invoke with `pnpm test` (or `pnpm test:watch` while iterating). `pnpm test:coverage` produces a coverage report.
- End-to-end tests live in `e2e/` and run with Playwright via `pnpm test:e2e`.
- Do not commit `.skip()` (or `.only()`) without a `TODO` explaining why and linking an issue. `.only()` should never reach `main`.

## Documentation

- Historical phase specs use a `_v1.md` suffix and are preserved for archaeology — don't edit them in-place when plans change; write the new version alongside.
- Current reference docs sit next to the code they document.
- Update docs in the same PR as the code change. A PR that changes behavior but leaves docs stale will be sent back.

## AI-generated contributions

If you use an AI assistant (Claude Code, Cursor, Copilot, etc.) to help write code:

- Make it read [`AGENTS.md`](./AGENTS.md) and [`CLAUDE.md`](./CLAUDE.md) first. Both are short and set expectations for this repo.
- Next.js 16 and React 19 break a lot of older training data. Verify generated code against the guides in `node_modules/next/dist/docs/` rather than trusting the model's memory.
- You are responsible for every line you submit. Review and test AI output the same way you would review a teammate's patch.

## Security

- Report vulnerabilities privately as described in [`SECURITY.md`](./SECURITY.md). Do not file public issues for security problems.
- Never commit secrets. `.env.example` is the shared template; real values belong in `.env.local` (gitignored) or in the deployment secret store.
- If you accidentally commit a secret, rotate it immediately — removing the commit is not sufficient.
