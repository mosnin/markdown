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

**Final release gate pass completed 2026-04-10.** All verification gates pass:
typecheck (application code), lint (0 errors), tests (138/138), build (clean).
See `docs/release_candidate_report_v1.md` for the full release gate report.

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
| Token expiry default | ✅ | 90-day default on all new/rotated tokens |
| Ownership checks on all API routes | ✅ | `allowedBoxIds` + workspace_id checks |
| Guide note protection | ✅ | Enforced in lifecycle service and tested |
| Write proposal trust model | ✅ | Proposals require human approval |
| Import human-session-only | ✅ | External connections cannot initiate import |
| Markdown sanitization | ✅ | `sanitize-html` applied at shared rendering seam |
| Content Security Policy | ✅ | Minimal meaningful CSP; unsafe-inline present but object-src/frame-src/base-uri protected |
| Security headers | ✅ | X-Content-Type-Options, X-Frame-Options: DENY, etc. |
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
| Integration tests (service-level) | ✅ | 4 modules: conflict detection, generated note auth, stable ID, lifecycle protection |
| Rollback safety unit tests | ✅ | Ownership, version identity, immutability invariants |
| Note update safety unit tests | ✅ | Content verbatim, diff from prior state, RPC error propagation |
| Context bundle assembly unit tests | ✅ | Ownership, exclusion rules, deduplication, ranking, linked limit |
| DB integration tests | ⏳ Deferred | Needs test Supabase instance — post-launch |
| E2E tests | ⏳ Deferred | No Playwright setup in V1 |

### Observability

| Item | Status | Notes |
|---|---|---|
| Structured JSON logging | ✅ | `src/lib/logger.ts` — JSON to stdout/stderr |
| Auth failure visibility | ✅ | Token inactive/expired/connection inactive logged |
| Auth exception visibility | ✅ | Exceptions in auth path logged with reason |
| Import failure logging | ✅ | Failures logged with workspace_id, box_id, filename, reason |
| Server action failure logging | ✅ | rollback, promote, approve/reject proposal all log structured errors |
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
| Server action field size guards | ✅ | `saveNoteAction` enforces title/content/summary/tag limits matching API route limits |
| Env variable validation | ✅ | `src/lib/env.ts` with `validateServerEnv()` |

### Environment and deployment

| Item | Status | Notes |
|---|---|---|
| `.env.example` completeness | ✅ | All required vars documented with setup instructions |
| Env validation module | ✅ | `src/lib/env.ts` with fail-fast on missing vars |
| MCP env documented | ✅ | In `.env.example` and `docs/deployment_v1.md` |
| Build passes with placeholder envs | ✅ | Verified by CI config |
| Security headers in production | ✅ | Configured in `next.config.ts` |
| Database migrations ready | ✅ | 12 SQL files in `supabase/migrations/` |

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

### CSP with `'unsafe-inline'`

- **Risk**: The V1 CSP includes `'unsafe-inline'` for script-src and style-src,
  which limits the CSP's XSS-mitigation value for inline payloads.
- **Severity**: Low — `sanitize-html` removes all script tags and event handlers
  before render. The CSP still provides meaningful protection: `frame-src none`,
  `object-src none`, `base-uri self`, `form-action self`, and restricted
  `connect-src` all provide real hardening.
- **Mitigation in V1**: CSP present; `sanitize-html` at rendering seam.
- **Post-launch fix**: Nonce-based CSP to remove `'unsafe-inline'` from script-src.

### Export artifact storage growth

- **Risk**: Export zip files in the private `exports` Storage bucket grow over
  time. Signed URLs expire in 1 hour but files persist.
- **Severity**: Low — bucket is private; stable resource-scoped paths with
  `upsert: true` mean re-exporting the same box overwrites its artifact,
  bounding growth to one file per named export resource.
- **Mitigation in V1**: Stable paths + upsert; SQL cleanup function installed
  (`cleanup_old_export_artifacts()`).
- **Post-launch action**: Schedule `cleanup_old_export_artifacts(7)` via pg_cron
  or a weekly Vercel Cron Job.

### Indefinite token lifetime possible

- **Risk**: The explicit `null` bypass path in `connection_service.ts` allows
  creating tokens without expiry. If used accidentally, tokens are valid
  indefinitely until revoked.
- **Severity**: Low — 90-day default is applied to all new and rotated tokens
  via `createConnectionToken`. The bypass requires deliberate code change.
- **Mitigation in V1**: 90-day default enforced at both creation points.
- **Post-launch consideration**: Enforce hard maximum token lifetime in V2.

### No DB-level integration or E2E tests

- **Risk**: DB-dependent behavior (version history, RPC atomicity, import
  collision modes) not covered by automated tests.
- **Severity**: Medium for ongoing development.
- **Mitigation in V1**: Service-level integration tests (mocked DB) cover the
  four highest-risk flows: proposal conflicts, generated note auth, stable ID
  resolution, lifecycle guide protection.
- **Post-launch fix**: Set up DB integration test harness with Supabase branching.

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

The remaining known risks (distributed rate limiting, CSP `unsafe-inline`,
DB integration tests) are appropriate post-launch hardening items and do not
block private beta with a controlled audience.
