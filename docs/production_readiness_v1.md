# Production Readiness — V1

This document is the launch readiness checklist for Context Store V1 private
beta. It records the state of every readiness dimension as of the final
hardening pass.

---

## Overall assessment

**Context Store V1 is ready for private beta launch.**

The system is functionally complete, trust-sensitive paths are covered by tests
and security review, the deployment path is documented and straightforward,
and remaining known risks are explicitly identified and assessed as acceptable
for the private beta scope.

---

## Checklist

### Application correctness

| Item | Status | Notes |
|---|---|---|
| Original V1 acceptance criteria | ✅ | All 18 ACs verified — see `v1_parity_report.md` |
| Corrected relationship contract | ✅ | Committed in hardening prompt 17 |
| Corrected vocabulary (read_hint, origin_type) | ✅ | Committed in hardening prompt 18 |
| Corrected portability contract | ✅ | Committed in hardening prompt 19 |
| Corrected generated note semantics | ✅ | Committed in prompt 20 |
| Template and starter flow | ✅ | Committed in prompt 21 |
| Import guide note restoration | ✅ | Fixed in parity pass |
| Bundle read audit (connection context) | ✅ | Fixed in parity pass |
| Note read response completeness | ✅ | Fixed in parity pass |

### Trust and security

| Item | Status | Notes |
|---|---|---|
| Bearer token verification | ✅ | Constant-time hash comparison, expiry, status checks |
| Ownership checks on all API routes | ✅ | `allowedBoxIds` + workspace_id checks |
| Guide note protection | ✅ | Enforced in lifecycle service and tested |
| Write proposal trust model | ✅ | Proposals require human approval |
| Import human-session-only | ✅ | External connections cannot initiate import |
| Markdown sanitization | ✅ | `sanitize-html` applied at shared rendering seam |
| Security headers | ✅ | X-Content-Type-Options, X-Frame-Options, etc. |
| Service role key isolation | ✅ | Used only in admin client, server-only |
| Error message leakage | ✅ | `E_INTERNAL` returns generic message |
| Auth failure logging | ✅ | Token expiry, inactive status logged without leaking token value |

### Testing

| Item | Status | Notes |
|---|---|---|
| Test framework set up | ✅ | vitest with @vitest/coverage-v8 |
| API response envelope tests | ✅ | 100% coverage of response helpers |
| Token format validation tests | ✅ | All format edge cases covered |
| Lifecycle guard tests | ✅ | Guide note protection, status transitions, ownership |
| Write proposal trust tests | ✅ | Permission checks, ownership, required fields, approval guards |
| Import vocabulary tests | ✅ | Canonical relationship types and read hints |
| Rate limiter tests | ✅ | Window logic, per-key isolation, expiry |
| Markdown sanitization tests | ✅ | XSS vectors, safe content preservation |
| Integration tests | ⏳ Deferred | Needs test Supabase instance — post-launch |
| E2E tests | ⏳ Deferred | No Playwright setup in V1 |

### Observability

| Item | Status | Notes |
|---|---|---|
| Structured JSON logging | ✅ | `src/lib/logger.ts` — JSON to stdout/stderr |
| Auth failure visibility | ✅ | Token inactive/expired/connection inactive logged |
| Auth exception visibility | ✅ | Exceptions in auth path logged with reason |
| Import failure logging | ✅ | Failures logged with workspace_id, box_id, filename, reason |
| Audit log (product events) | ✅ | All workspace events append-only in `audit_events` table |
| Request correlation | ✅ | Each API response includes unique `request_id` in meta envelope |

### Validation

| Item | Status | Notes |
|---|---|---|
| File size pre-check on import | ✅ | `file.size` checked before `arrayBuffer()` read |
| Collision mode validation | ✅ | Hard failure on invalid mode |
| Bearer token structural validation | ✅ | Regex + length + prefix checks |
| Proposal type validation | ✅ | Allowlist check at API route |
| Pagination bounds | ✅ | `Math.min(limit, MAX_LIMIT)`, `Math.max(page, 1)` |
| Note schema validation | ✅ | Zod schemas for create/update |
| Tag array type validation | ✅ | Inline type check on tag arrays |
| Env variable validation | ✅ | `src/lib/env.ts` with `validateServerEnv()` |

### Environment and deployment

| Item | Status | Notes |
|---|---|---|
| `.env.example` completeness | ✅ | All required vars documented with setup instructions |
| Env validation module | ✅ | `src/lib/env.ts` with fail-fast on missing vars |
| MCP env documented | ✅ | In `.env.example` and `docs/deployment_v1.md` |
| Build passes with placeholder envs | ✅ | Verified by CI config |
| Security headers in production | ✅ | Configured in `next.config.ts` |
| Database migrations ready | ✅ | 11 SQL files in `supabase/migrations/` |

### CI and developer workflow

| Item | Status | Notes |
|---|---|---|
| GitHub Actions CI workflow | ✅ | `.github/workflows/ci.yml` |
| Test command | ✅ | `pnpm test` (vitest) |
| Type check command | ✅ | `pnpm typecheck` (tsc --noEmit) |
| Lint command | ✅ | `pnpm lint` (eslint) |
| Full CI command | ✅ | `pnpm ci` (typecheck + lint + test + build) |
| Build command | ✅ | `pnpm build` (Next.js) |

### Documentation

| Item | Status |
|---|---|
| README.md | ✅ |
| docs/architecture.md | ✅ |
| docs/deployment_v1.md | ✅ |
| docs/security_notes_v1.md | ✅ |
| docs/testing_strategy_v1.md | ✅ |
| docs/production_readiness_v1.md | ✅ (this file) |
| docs/v1_parity_report.md | ✅ |
| docs/canonical_api_v1.md | ✅ |
| docs/import_export_v1.md | ✅ |

---

## Known V1 risks

These risks are assessed as **acceptable for private beta**. Each has a
documented mitigation path.

### Rate limiting is per-instance only

- **Risk**: Vercel serverless has multiple concurrent instances. The in-process
  rate limiter does not share state across instances, so the effective limit
  is `configured_limit × instance_count`.
- **Severity**: Medium for a public launch; Low for private beta where usage
  is controlled.
- **Mitigation in V1**: In-process limiter bounds abuse per instance. Single-
  workspace architecture limits blast radius.
- **Post-launch fix**: Replace in-memory store in `src/lib/api/rate_limit.ts`
  with Vercel KV (Upstash Redis).

### No Content-Security-Policy header

- **Risk**: Without a CSP, XSS payloads that bypass `sanitize-html` could
  execute scripts inline.
- **Severity**: Low — sanitize-html removes all script tags and event handlers.
  Single-owner context means the attacker must control imported content.
- **Mitigation in V1**: sanitize-html at rendering seam.
- **Post-launch fix**: Add a restrictive CSP with nonce or hash for Next.js.

### Export artifact accumulation

- **Risk**: Export zip files accumulate in the private `exports` Storage bucket
  with no automatic purge.
- **Severity**: Low — signed URLs expire in 1 hour, bucket is private.
  Storage cost grows over time.
- **Post-launch fix**: Add a Supabase Edge Function or cron job to delete
  artifacts older than 24 hours.

### Optional token expiry

- **Risk**: Bearer tokens with no `expires_at` are valid indefinitely until
  explicitly revoked.
- **Severity**: Low — owner controls token lifecycle; revocation is available
  in Settings → Connections.
- **Post-launch consideration**: Enforce maximum token lifetime in V2.

### No integration or E2E tests

- **Risk**: Service-level and route-level correctness not covered by automated
  tests. Regressions in DB-dependent behavior (version history, RPC atomicity)
  not caught before deploy.
- **Severity**: Medium for ongoing development.
- **Post-launch fix**: Set up integration test harness with Supabase branching.

---

## Private beta launch decision

**APPROVED FOR PRIVATE BETA**

Context Store V1 meets the requirements for a private beta launch:

1. All 18 original V1 acceptance criteria are verified ✅
2. Trust-sensitive flows are tested and reviewed ✅
3. Meaningful security gaps are fixed or explicitly documented ✅
4. Deployment path is documented and verified ✅
5. Known risks are bounded by the private beta audience ✅
6. Audit trail and version history provide operational reversibility ✅

The remaining known risks (distributed rate limiting, CSP, artifact cleanup)
are appropriate post-launch hardening items and do not block private beta
with a controlled audience.
