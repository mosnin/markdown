# Security Notes — V1

This document describes the security model, known risks, and mitigations in
place for Context Store V1.

---

## Security model overview

Context Store V1 is a **single-owner application**. One authenticated user owns
one workspace. External AI agents authenticate via bearer tokens (connections)
and operate within scopes defined by the human owner.

The primary trust boundary is between:
1. **The authenticated owner** — full access to their workspace via Supabase SSR
   session auth + Row Level Security
2. **External connections** — bearer token authenticated, scoped to specific
   boxes and permission modes, no destructive capabilities by design

---

## Authentication

### Human sessions

- Supabase SSR cookie auth via `@supabase/ssr`
- Magic link authentication (email OTP) — no passwords stored
- Session refresh handled in `middleware.ts` (auth cookies only, no business logic)
- All protected server components and pages use `requireAuthenticatedUser()` which
  redirects to `/sign_in` on failure — no unauthorized renders

### External connections (bearer tokens)

- Token format: `csk_v1_<64 lowercase hex>` — 256 bits of entropy
- Token storage: prefix (8 hex) + SHA-256 hash stored in DB — raw token never persisted
- Verification: constant-time `timingSafeEqual()` hash comparison prevents timing attacks
- Expiry: optional `expires_at` on token records — enforced on every request
- Connection status: `ACTIVE` required on both token record and parent connection
- Auth failures: logged with event type but never the token value

Code: `src/server/auth/get_connection_context.ts`

---

## Authorization

### Human app

- Route protection: `requireAuthenticatedUser()` in all protected layouts
- Workspace isolation: `getRequestContext()` resolves workspace from user session
- Row Level Security (RLS): enabled on all data tables — queries automatically
  scoped to authenticated user's workspace
- Additional server-side ownership checks in service layer (defense in depth)

### Canonical API (bearer token)

- **Admin client** (`createAdminClient`) bypasses RLS — intentional, as bearer
  token requests have no user session
- **All authorization is explicit**: every API route handler checks
  `ctx.allowedBoxIds` before returning any box-scoped data
- Two-hop ownership pattern: note/folder → box → workspace_id — no resource
  contains workspace_id directly
- Import endpoint requires human session — external connections cannot initiate
  bulk imports (see import section)

### Permission modes

| Mode | Can read | Can propose | Can generate |
|---|---|---|---|
| `read_only` | Yes | No | No |
| `propose_writes` | Yes | Yes | No |
| `generate_in_allowed_folders` | Yes | Yes | Yes (only in allowed folders) |

External connections cannot: delete notes, trash content, change lifecycle state,
approve proposals, modify connection scopes, or access other workspaces.

---

## Import security

- Import requires human session — connections cannot initiate imports (V1)
- File size limit: 25 MB, enforced **before** reading into memory (request body
  check on `file.size`)
- Supported file types: `.md`, `manifest.json`, `README.md` — others generate
  warnings and are ignored
- Object count limit: 1,000 combined folders + notes
- Collision mode must be explicitly chosen — no silent overwrites
- Manifest vocabulary validation: non-canonical `relationship_type` values skip
  the link with a warning; non-canonical `read_hint` values are nulled with a warning
- `origin_type` on import is always forced to `"imported"` — manifest value ignored

---

## Export and artifact delivery

- All exports go to a private Supabase Storage bucket (`exports`) — no public URLs
- Signed URLs expire in 1 hour
- Export artifact response includes `signed_url`, `expires_at`, `filename`, `size_bytes`
- Ownership verified before export: `box.workspace_id === workspaceId`
- V1 known gap: Export artifacts accumulate in the `exports` bucket with no
  automatic purge. Manual cleanup or a scheduled function is needed for production.

---

## Markdown rendering

- All markdown rendering goes through `src/lib/markdown.ts` (single seam)
- `sanitize-html` is applied to `marked` output before any HTML reaches
  `dangerouslySetInnerHTML`
- Allowed tags: standard markdown output elements (h1-h6, p, a, img, code, pre,
  table, blockquote, etc.)
- Blocked: `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`,
  all event handler attributes (`onclick`, `onload`, etc.)
- Allowed href schemes: `http`, `https`, `mailto`
- `javascript:` and `data:` URIs in `href` are stripped
- `data:` URIs in `src` (img) are allowed for inline images

**Note (V1):** Context Store is a single-owner workspace. The practical XSS risk
from owner-authored content is low. Sanitization is added as a correct default
that protects against imported packages containing malicious HTML and future
multi-author paths.

---

## Secret handling

- `SUPABASE_SERVICE_ROLE_KEY` is used only in `src/lib/supabase/admin.ts`
- The service role client is created per-request, never cached in module scope
- Bearer tokens are never logged — only the 8-char `token_prefix` is logged
- Auth failure log events include the prefix and failure reason, not the token
- Connection secrets are masked in the UI after initial display

### Secret storage in DB

| Secret | Storage |
|---|---|
| User passwords | None — magic link auth only |
| Bearer token (raw) | Never stored — SHA-256 hash stored instead |
| Supabase service role key | Environment variable only — never in DB |
| Connection token prefix | Stored in plaintext (used for DB lookup) |

---

## Error message policy

- `E_INTERNAL` responses return `"Internal server error"` only — no stack traces
- `E_NOT_FOUND` returns the same message regardless of whether the resource
  doesn't exist vs. belongs to a different workspace (prevents enumeration)
- Auth failures return `401 Unauthorized` — no detail about which check failed
- Service layer errors use legible messages for human debugging but must not
  include database internals (RPC names, column names) in external responses

---

## Security headers

Set on all routes via `next.config.ts`:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

**V1 known gap:** No Content-Security-Policy (CSP) header is set. Adding a
restrictive CSP for a Next.js app with inline styles (Tailwind) requires careful
nonce or hash configuration. Deferred to V2.

---

## Rate limiting

In-process sliding window rate limiter at `src/lib/api/rate_limit.ts`.

| Limiter | Limit | Window |
|---|---|---|
| `apiReadLimit` | 60 requests | 60 seconds |
| `apiWriteLimit` | 20 mutations | 60 seconds |
| `importExportLimit` | 5 initiations | 60 seconds |

**V1 known limitation:** The in-process limiter does not share state across
Vercel serverless function instances. In a multi-instance production deployment,
each instance maintains its own counter.

For production, replace the in-memory store in `rate_limit.ts` with:
- Vercel KV (Upstash Redis) — `@vercel/kv`
- Or a Supabase-backed counter with an appropriate TTL function

The `checkRateLimit(key, limit, windowSecs)` interface is intentionally stable
to support this swap.

---

## Known V1 risks and deferrals

| Risk | Severity | Mitigation | Deferred action |
|---|---|---|---|
| No distributed rate limiting | Medium | In-process limiter per instance | Replace with Vercel KV post-launch |
| No CSP header | Medium | sanitize-html prevents injected scripts; owner-only content | Add CSP in V2 |
| Export artifact accumulation | Low | Private bucket, signed URLs expire | Add scheduled purge function |
| No token rotation enforcement | Low | Expiry field optional; owner manages tokens | Enforce rotation in V2 |
| Single-instance rate limits | Low | Abuse still bounded per-instance | Distributed limiter post-launch |
| MCP stdio process: no independent auth | Info | MCP reads CONTEXT_STORE_CONNECTION_SECRET from env — same auth as API | No change needed; documented |

---

## Audit coverage

All security-relevant events are recorded in the append-only audit log:

- `connection.token_created`, `connection.token_revoked`
- `write_proposal.created`, `write_proposal.approved`, `write_proposal.rejected`
- `note.exported`, `box.exported`, `bundle.exported`
- `import.completed`
- `note.trashed`, `note.archived`, `note.restored`
- `guide_note.assigned`
- `bundle.read` (with connection context for API calls)

Audit events are never deleted. They include `workspace_id`, actor type, actor id,
target resource, and operation metadata.
