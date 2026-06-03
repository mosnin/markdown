# Security review — public write-capable surface (OneLoop pass)

Date: 2026-06-03
Scope reviewed: `src/app/api/**` (mcp, oauth/*, agent/tools/*, billing/webhook,
inngest), `src/lib/api/rate_limit.ts`, `src/server/policies/**`,
`src/server/resolvers/**`. Plus the supporting services those entry points call
(`oauth_scope_service`, `oauth_token_service`, `rate_limit_service`,
`mcp_auth_adapter`, `supabase/admin`).

This was an audit-first pass. Exactly one low-risk, surgical hardening fix was
made (area 5 — SSRF). Everything else is documented as-is.

Context on the two rate-limit modules:
- `src/lib/api/rate_limit.ts` — in-process / Upstash sliding-window limiter used
  on the canonical `/api/v1/**` and MCP write hot paths.
- `src/server/services/rate_limit_service.ts` — durable, cross-instance
  `rate_limit_buckets` limiter used by the OAuth surfaces (register / token /
  authorize / revoke). The split is intentional and documented in that file's
  header (anti-abuse needs cross-region durability; burst control does not).

---

## 1. Rate limiting / abuse controls on public endpoints — SOLID

All four named entry points apply a limiter before doing real work.

- **POST /api/oauth/token** — `src/app/api/oauth/token/route.ts:79`
  ```ts
  // Rate limit per client_id BEFORE any DB lookups so an unknown client
  // cannot be used as an oracle to hammer the token endpoint.
  const rl = await checkRateLimit(admin, tokenBucketKey(clientId), TOKEN_LIMIT);
  if (!rl.allowed) { ... return rateLimited(rl.retryAfterSeconds); }
  ```
  `TOKEN_LIMIT = { limit: 30, windowSeconds: 60 }` (`rate_limit_service.ts:244`).
  Keyed on `client_id`, applied **before** the `_internalGetClientWithSecret`
  lookup, so an unknown client cannot be used as a timing oracle. Trip is
  audited.

- **POST /api/oauth/register** — `src/app/api/oauth/register/route.ts:79`
  Requires an authenticated identity first (`resolveCallerUserId`, 401 if none),
  then `checkRateLimit(admin, registerBucketKey(callerUserId), REGISTRATION_LIMIT)`
  with `REGISTRATION_LIMIT = { limit: 3, windowSeconds: 3600 }`. No anonymous
  registration. Caller IP is also recorded on the client row for abuse triage
  (`register/route.ts:166-172`).

- **/oauth/authorize approval action** — `src/app/oauth/authorize/actions.ts:59`
  (approve) and `:176` (deny). Both call
  `checkRateLimit(admin, authorizeBucketKey(ctx.user.id), AUTHORIZE_LIMIT)` with
  `AUTHORIZE_LIMIT = { limit: 10, windowSeconds: 60 }`, keyed on the signed-in
  user, applied before scope resolution / code minting. Trips audited.
  (This action lives under `src/app/oauth/`, a server action, not `src/app/api/`.)

- **MCP create_write_proposal** — `src/app/api/mcp/route.ts:408-422`
  ```ts
  const RATE_LIMITED_WRITE_TOOLS = new Set([
    "create_branch", "write_to_branch", "create_generated_note",
    "create_write_proposal",
  ]);
  if (RATE_LIMITED_WRITE_TOOLS.has(name)) {
    const rl = await apiWriteLimit(ctx.clientId);
    if (!rl.allowed) throw toolError(-32029, ...);
  }
  ```
  `apiWriteLimit` = 20/min (`rate_limit.ts:208`), keyed on `clientId`, applied in
  `dispatchTool` after scope+role gating, for every write tool (not just
  proposals). The canonical twin `POST /api/v1/write_proposals` applies the same
  `apiWriteLimit(ctx.connectionId)` at `write_proposals/route.ts:91` plus a 1 MB
  payload cap and field-size guards.

Residual risk (low, by design): all limiters **fail OPEN** on backend (Redis/DB)
error — explicitly chosen as defense-in-depth, documented in both limiter
headers. Auth/scope/role gates are the primary controls and do not fail open.
The durable OAuth limiter uses fixed windows, so a caller can burst up to ~2x at
a window boundary (documented, accepted for coarse anti-abuse). The MCP write
limiter keys on `clientId`; one OAuth client shared across many users shares a
single 20/min budget — fine for abuse control, not a fairness mechanism.

---

## 2. Scope clamps — SOLID

**Viewer clamp.** A viewer cannot be *granted* propose/generate/branch scopes.
Enforced in `resolveGrantedScopes` (`oauth_scope_service.ts:199-207`) via
`roleCanGrant(role, OAUTH_SCOPES[s].minRole)` — `context:propose`,
`context:generate`, and `context:branch` all declare `minRole: "member"`
(`oauth_scope_service.ts:75-91`), so a viewer's grant is rejected at consent
time with `invalid_scope`. Only `context:read` / `context:search` /
`context:bundles` (all `minRole: "viewer"`) survive — i.e. effectively clamped
to read-only. This runs both in the authorize page and the approve server action
(`actions.ts:105`). Belt-and-suspenders at runtime: even if a write scope were
somehow present on a viewer's token, `mcp/route.ts:401` and the canonical
`requireWrite` (`mcp_auth_adapter.ts:382-385`) reject `role === "viewer"`
regardless of scope.

**`context:read` cannot call `create_write_proposal`.** The tool declares
`scope: "context:propose"` (`mcp/route.ts:218`). `dispatchTool` gates on
`hasScope(ctx.scope, tool.scope)` first (`mcp/route.ts:389-391`); a
`context:read`-only token throws `-32002` before any work. `tools/list` also
filters to scoped tools (`mcp/route.ts:1189-1195`), so a read-only token never
even sees the proposal tool. Canonical path mirrors this:
`requireScope(ctx, "context:propose")` → `E_INSUFFICIENT_SCOPE`
(`write_proposals/route.ts:83-85`). Covered by
`oauth_scope_service.test.ts` and `mcp_auth_adapter.test.ts` (72 tests pass).

Residual risk: none material. Box-narrowing (`context:box:<uuid>`) is
additionally enforced per-tool via `canAccessBox(...)` throughout
`mcp/route.ts`, and the granted box set is intersected with live workspace boxes
in `mcp_auth_adapter.ts:204-215`.

---

## 3. Service-role key (`createAdminClient`) — SOLID

`src/lib/supabase/admin.ts` reads `SUPABASE_SERVICE_ROLE_KEY` (RLS bypass) and is
documented "NEVER import in client components."

Verified:
- No `'use client'` file imports `createAdminClient` or `supabase/admin`
  (grepped all `.ts`/`.tsx`; zero hits).
- The service-role key is never exposed under a `NEXT_PUBLIC_*` name (grep for
  `NEXT_PUBLIC.*SERVICE_ROLE` is empty); it is only read in `admin.ts` and listed
  as a server-only required var in `src/lib/env.ts:32`.
- Every reachable caller is a server context: API route handlers that
  authenticate first (OAuth bearer, `wopr_` operator key, agent shared secret,
  or cookie session), Inngest functions, and `scripts/`. The unauthenticated
  prologue uses (e.g. `mcp/route.ts:354`, `register` token-lookup) only *read*
  the admin client to resolve/verify the caller's own bearer token before any
  privileged action — the key itself is never returned to the client.

Residual risk (informational, not a finding): with 131 import sites, RLS-bypass
correctness rests entirely on each caller passing the right
`workspace_id`/`box_id` filters (the documented contract). That is a broad,
ongoing invariant but out of scope to re-audit row-by-row here; no unauthenticated
or client-exposed path was found.

---

## 4. Webhook signature verification — SOLID (one config note)

- **POST /api/billing/webhook** — `src/app/api/billing/webhook/route.ts:21-27`.
  Uses `Webhook({ webhookSecret: process.env.CREEM_WEBHOOK_SECRET, ... })` from
  `@creem_io/nextjs`, which verifies the HMAC-SHA256 `creem-signature` header
  before any callback fires. If the secret is unset the handler is replaced with
  one that returns 500 (`:22-25`) — **fails closed**, never processes unverified
  events. Handlers use `createAdminClient` only after the adapter has verified
  the signature, and re-throw on DB error so Creem retries (`:66`, `:193`).

- **POST/PUT/GET /api/inngest** — `src/app/api/inngest/route.ts:16-20`. Uses
  `serve({ client, functions, signingKey: process.env.INNGEST_SIGNING_KEY })`;
  the Inngest SDK verifies request signatures against the signing key.

Note for reconciliation: billing logic was only read, not modified (the BILLING
agent owns billing). I did not change `webhook/route.ts`. One operational
caveat worth flagging — billing webhook signature verification depends entirely
on `CREEM_WEBHOOK_SECRET` being present in prod; the fail-closed 500 is correct
but means a missing secret silently disables all subscription updates. That is a
deploy/config concern, not a code change.

---

## 5. SSRF on URL-fetching tools — FIXED

`web_fetch` (`src/app/api/agent/tools/web_fetch/route.ts`) is the only tool that
fetches a caller-supplied URL. It is shared-secret gated (`verifyAgentRequest`),
scheme-restricted to http/https, runs `ssrfCheck` on the input URL **and**
re-runs it on `response.url` after redirects (`:166-176`) to defeat
redirect-based SSRF, with a 10s timeout and 32 KB cap. `web_search`
(`agent/tools/web_search/route.ts`) only calls a fixed Tavily endpoint
(`TAVILY_ENDPOINT`), not a user URL — no SSRF surface.

**Gap found and fixed:** the `isPrivateHostname` blocklist matched only
dotted-decimal IPv4 and a few IPv6 prefixes. **IPv4-mapped IPv6 literals
bypassed it.** Verified against the actual helper logic + Node's `URL` parser:
- `http://[::ffff:169.254.169.254]/` normalizes to hostname
  `[::ffff:a9fe:a9fe]` → the old guard returned `false` (**not blocked**). This
  is the cloud-metadata endpoint (169.254.169.254) the code comments explicitly
  claim to block. On a dual-stack host the OS routes `::ffff:a.b.c.d` to the
  IPv4 destination.
- `http://[::ffff:127.0.0.1]/` → `[::ffff:7f00:1]` → also not blocked (loopback).
- (Integer/hex/octal IPv4 like `http://2130706433/` were already safe — Node's
  `URL` normalizes them to `127.0.0.1` before `hostname` is read. Now covered by
  a regression test.)

**Fix** (`web_fetch/route.ts`): refactored the IPv4 range logic into a shared
`isPrivateIpv4(dotted)` helper (also validates octets `<= 255`), then extended
`isPrivateHostname` to detect IPv4-mapped/compat IPv6 — both the embedded
dotted-quad form (`::ffff:169.254.169.254`) and the hex form
(`::ffff:a9fe:a9fe`, folded back to dotted-decimal) — and run them through the
same private-range check. The change only ever blocks *more*; a public mapped
address (`::ffff:8.8.8.8`) is verified to stay allowed. This follows the
existing in-file guard pattern (no new deps, no new module). Added 6 unit tests
to `src/tests/unit/web_fetch_route.test.ts` (now 24 passing).

Residual risk (documented as NEEDS ATTENTION, not fixed here — see below): the
guard is hostname/literal-based and does **not** resolve DNS. A public hostname
whose A/AAAA record points at a private/metadata IP (DNS rebinding) is not caught
by `ssrfCheck` alone. This is a larger change (resolve-then-pin, or block at the
socket layer) and is intentionally out of scope for this surgical pass.

---

## NEEDS ATTENTION (not changed — risky/ambiguous/larger than a surgical fix)

1. **DNS-rebinding SSRF in `web_fetch` (medium).** `ssrfCheck` blocks IP literals
   and obvious internal names but does not resolve DNS, so
   `http://attacker.example/` resolving to `169.254.169.254` (or a 10.x host)
   still passes the pre-fetch and post-redirect checks. Proper mitigation
   (resolve all A/AAAA records, reject if any is private, and pin the connection
   to the validated IP — or an egress proxy / allowlist) is a deliberate,
   testable change, not a one-line tightening. The new IPv4-mapped-IPv6 fix
   closes the literal-bypass vector but not rebinding.

2. **All rate limiters fail OPEN (low, by design).** Both limiter backends return
   "allowed" on Redis/DB error. Correct as defense-in-depth, but a sustained
   backend outage removes all rate limiting on the public OAuth + MCP surfaces at
   once. If the threat model tightens before opening to strangers, consider
   fail-closed (or a short in-process fallback counter) specifically for
   `POST /api/oauth/register` and `POST /api/oauth/token`.

3. **`createAdminClient` RLS-bypass blast radius (informational).** 131 server
   call sites rely on manual `workspace_id`/`box_id` scoping for tenant
   isolation since RLS is off. No unauthenticated/client-exposed path was found,
   but this is the single largest authorization invariant in the codebase and
   warrants a dedicated, repo-wide pass (or lint rule) rather than spot checks.

4. **Billing webhook secret is a single point of failure (config, not code).** A
   missing `CREEM_WEBHOOK_SECRET` makes `/api/billing/webhook` return 500 for
   every event (fail-closed, good) but silently halts all subscription state
   updates. Flagging for the BILLING agent / ops: ensure the secret is set and
   monitored in prod.

---

## Overlap with /api/mcp and /api/billing (for reconciliation)

- **/api/mcp** — read only; **no changes made.** Audited the create_write_proposal
  path, scope/role gates, and write-tool rate limiting (areas 1, 2). Note for the
  BILLING agent: the route's create_write_proposal / create_generated_note /
  write_to_branch handlers are the MCP-side write entry points where any
  proposal-quota service would need to hook in; route-level `apiWriteLimit`
  (20/min/client) is already applied there and is independent of quota.
- **/api/billing/webhook** — read only; **no changes made.** Confirmed Creem HMAC
  verification and fail-closed-on-missing-secret behavior; billing quota/logic
  untouched per task boundary.

## Files changed
- `src/app/api/agent/tools/web_fetch/route.ts` — added `isPrivateIpv4` helper;
  extended `isPrivateHostname` to block IPv4-mapped/compat IPv6 literals.
- `src/tests/unit/web_fetch_route.test.ts` — 6 new SSRF regression tests.
- `docs/security_review_oneloop.md` — this report.

## Verification
- `tsc --noEmit`: 0 errors.
- `eslint` on changed files: 0 errors (7 pre-existing `as any` warnings in test
  mocks, on lines not touched by this change).
- `vitest run` web_fetch + oauth/mcp/rate-limit suites: 96 tests pass
  (24 web_fetch + 72 oauth/mcp/rate-limit).
