# Cloudflare Workers v1

Two edge workers offload computation from the Next.js server.

## 1. Diff Worker (`context-store-diff`)

**Location:** `workers/diff-worker/`

Computes prose diffs on the edge using the `diff` library, keeping the
computation off the Next.js server and closer to the user.

### API

**`POST /diff`**

Request body:
```json
{
  "before": "string | null",
  "after": "string | null",
  "mode": "words | lines"
}
```

Response:
```json
{
  "parts": [{ "value": "...", "added": true, "removed": false }],
  "fallback": false
}
```

- Content > 50 KB auto-falls back to line-level diff (`fallback: true`).
- Explicit `mode: "lines"` forces line-level; `mode: "words"` forces word-level.

### Auth

`Authorization: Bearer <DIFF_WORKER_SECRET>` header required on every request.

### CORS

Only the origin in the `ALLOWED_ORIGIN` env var is permitted.

### Environment variables

| Variable | Where to set | Description |
|---|---|---|
| `DIFF_WORKER_SECRET` | `wrangler secret put` | Shared secret for auth |
| `ALLOWED_ORIGIN` | `wrangler secret put` | Allowed CORS origin (e.g. `https://app.example.com`) |

### Next.js integration

| Variable | Where to set | Description |
|---|---|---|
| `NEXT_PUBLIC_DIFF_WORKER_URL` | `.env.local` | Worker base URL (e.g. `https://context-store-diff.<account>.workers.dev`) |
| `NEXT_PUBLIC_DIFF_WORKER_SECRET` | `.env.local` | Must match the worker's `DIFF_WORKER_SECRET` |

Client: `src/lib/diff_worker_client.ts` -- `computeDiffViaWorker()` with 3 s timeout.

Component: `src/components/product/prose_diff.tsx` -- shows local diff immediately, replaces with worker result when it arrives.

---

## 2. Bundle Cache Worker (`context-store-bundle-cache`)

**Location:** `workers/bundle-cache-worker/`

KV-backed cache for context bundle assembly results. Avoids redundant
assembly when the same bundle is requested within the TTL window.

### API

**`POST /cache/get`**

Request body:
```json
{ "key": "bundle:<workspaceId>:<noteId>:<branchId>" }
```

Response: `{ "value": <cached bundle object> }` on hit, `404` on miss.

**`POST /cache/set`**

Request body:
```json
{
  "key": "bundle:<workspaceId>:<noteId>:<branchId>",
  "value": { ... },
  "ttl": 300
}
```

Response: `{ "ok": true }` on success.

### Auth

`Authorization: Bearer <BUNDLE_CACHE_SECRET>` header required.

### Environment variables

| Variable | Where to set | Description |
|---|---|---|
| `BUNDLE_CACHE_SECRET` | `wrangler secret put` | Shared secret for auth |
| `ALLOWED_ORIGIN` | `wrangler secret put` | Allowed CORS origin |
| `BUNDLE_CACHE` | KV namespace binding in `wrangler.toml` | Replace the placeholder namespace ID |

### Next.js integration

| Variable | Where to set | Description |
|---|---|---|
| `NEXT_PUBLIC_BUNDLE_CACHE_URL` | `.env.local` | Worker base URL |
| `NEXT_PUBLIC_BUNDLE_CACHE_SECRET` | `.env.local` | Must match the worker's `BUNDLE_CACHE_SECRET` |

Client: `src/lib/bundle_cache_client.ts` -- `getCachedBundle()` / `setCachedBundle()`.

Wired into: `src/server/services/context_bundle_service.ts` -- checks cache before assembly, stores after assembly with 5 min TTL. Cache key includes `branchId` to prevent stale cross-branch reads.

---

## Deployment

```bash
# Deploy both workers
npm run workers:deploy

# Local development (both workers)
npm run workers:dev
```

Before first deploy, create the KV namespace and set secrets:

```bash
# Diff worker
cd workers/diff-worker
wrangler secret put DIFF_WORKER_SECRET
wrangler secret put ALLOWED_ORIGIN

# Bundle cache worker
cd workers/bundle-cache-worker
wrangler kv namespace create BUNDLE_CACHE
# Update the namespace ID in wrangler.toml
wrangler secret put BUNDLE_CACHE_SECRET
wrangler secret put ALLOWED_ORIGIN
```

## Graceful degradation

Both workers are optional. When the `NEXT_PUBLIC_*_URL` env vars are unset:

- Diff: `computeDiffViaWorker` returns `null`, component uses local `diffWords`/`diffLines`
- Bundle cache: `getCachedBundle`/`setCachedBundle` no-op, assembly runs every time
