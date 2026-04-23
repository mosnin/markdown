# Security Policy

## Reporting a Vulnerability

Please report suspected vulnerabilities by opening a private security advisory
on the GitHub repository (Security tab → "Report a vulnerability"). Do not
open a public issue or pull request for undisclosed security problems.

## Supported Versions

Only the latest `main` branch is supported with security fixes. Older branches
and tagged snapshots receive no backported patches.

## Threat Model Summary

### Authentication boundary

- Supabase Auth issues sessions; Postgres Row Level Security (RLS) enforces
  per-workspace access on every workspace-scoped table via the
  `workspace_memberships` table.
- Server actions and protected pages call `requireAuthenticatedUser()` (see
  `src/server/auth/require_authenticated_user.ts`), which redirects to
  `/sign_in` when no session or workspace is present and otherwise returns a
  non-null `RequestContext`.

### Server-action boundary

Every server action re-checks ownership before database writes: after
`requireAuthenticatedUser()`, the action loads the target row and compares
`workspace_id` against `ctx.workspace.id` (see `uploadNoteImageAction` and
`describeImageAction` in `src/app/app/notes/image_actions.ts`).

### Admin client usage

The Supabase admin (service-role) client is restricted to Inngest background
functions, maintenance scripts, and the Modal harness. It is never used from
user-facing server actions or route handlers that trust user input.

### Upload validation

Image uploads (`src/app/app/notes/image_actions.ts`) enforce:

- A MIME whitelist `MIME_TO_EXT` of `image/jpeg`, `image/jpg`, `image/png`,
  `image/webp`, `image/gif`. SVG is deliberately excluded because SVG files
  can carry `<script>` tags and would execute as XSS when served from the
  public `note-images` bucket.
- A size cap of `MAX_FILE_SIZE = 10 * 1024 * 1024` (10 MB).

Voice uploads (`src/app/api/voice/transcribe/route.ts`) enforce a size cap
of `MAX_AUDIO_BYTES = 25 * 1024 * 1024` (25 MB, matching the Whisper API
limit).

### SSRF protection for `web_fetch`

The `web_fetch` workflow node in
`src/lib/inngest/functions/execute_workflow.ts` calls `assertSafeUrl(url)`
before issuing any outbound request. That helper:

- Rejects any protocol other than `http:` / `https:`.
- Blocks the hostname set `BLOCKED_HOSTNAMES = { "localhost", "127.0.0.1",
  "::1", "0.0.0.0", "metadata.google.internal" }`.
- Blocks IPv4 literals in the RFC-1918 and link-local ranges via the inline
  check: `a === 10`, `a === 172 && b >= 16 && b <= 31`, `a === 192 && b ===
  168`, and `a === 169` (covers `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, and `169.254.0.0/16`).

### Rate limits

Implemented in `src/lib/api/rate_limit.ts` (sliding-window counter, Upstash
Redis in production with an in-memory fallback for dev/test). Relevant
caps:

- Voice transcription: 10 per minute per user, keyed
  `voice:transcribe:${user.id}`.
- Image description (vision): 10 per minute per user, keyed
  `image:describe:${ctx.user.id}`.
- Additional pre-baked limiters for API reads/writes, imports/exports,
  operator runs, deep search, and browsing sessions are defined in the same
  file.

### Cron idempotency

Scheduled triggers dispatch inside per-minute buckets. The `step.run` id is
`` `trigger-${t.id}-bucket-${bucket}` `` (see
`src/lib/inngest/functions/execute_scheduled_triggers.ts`), so Inngest
retries landing inside the same minute bucket are deduplicated.

## Known Non-Issues

- A retry that crosses a minute boundary can produce a second fire for the
  same trigger. This is an intentional trade-off in favour of availability.
- Scheduled workflows create a new `workflow_run` row per tick, the same way
  a manual Run does. Tick-to-tick deduplication is not applied.

## Secrets Handling

`.env` files are listed in `.gitignore`. `.env.example` is the shared
template and must contain only placeholder values. Never commit real API
keys, Supabase service-role keys, or database credentials. Rotate any key
that lands in Git history.

## Dependency Hygiene

Run `pnpm audit` periodically and before cutting a release. Advisories that
require operator action (env rotation, config change, forced upgrade) will
be disclosed via a GitHub security advisory on this repository.
