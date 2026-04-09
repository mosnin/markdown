# Testing Strategy — V1

## Philosophy

Tests in Context Store V1 target the highest-risk trust boundaries and pure
business logic. The goal is a reliable, maintainable test foundation — not
exhaustive coverage of every code path.

**Prioritize tests for trust-sensitive flows first, then infrastructure, then
pure logic.**

---

## Running tests

```bash
# Run all unit tests once
pnpm test

# Watch mode (re-runs on file change)
pnpm test:watch

# With coverage report
pnpm test:coverage
```

Tests live in `src/tests/unit/`. The vitest configuration is at
`vitest.config.ts`.

---

## Test modules

### `api_response.test.ts`

Covers the canonical API response envelope contract:
- `apiOk` wraps data correctly, includes api_version and unique request_id
- `apiError` builds correct error_code and message fields
- All convenience error constructors (401, 403, 404, 400, 500) return correct status codes
- `E_INTERNAL` does not leak stack traces or internal error details

**Why:** Every API consumer depends on this envelope. A regression here would
break all external integrations.

---

### `token_format.test.ts`

Covers structural validation of connection bearer tokens:
- Token format: `csk_v1_<64 lowercase hex>`
- Rejects missing headers, wrong prefix, wrong length, non-hex characters
- Documents the token format contract precisely

**Why:** Token format validation is the first line of defense in the API auth
path. Pure logic, zero DB dependencies, high confidence value.

---

### `lifecycle_guards.test.ts`

Covers the lifecycle service trust invariants:
- Guide note protection: `archiveNote` and `trashNote` throw when the note is
  the current box guide note
- Status transition guards: cannot archive an already-archived note, cannot
  trash an already-trashed note
- Ownership enforcement: wrong `workspace_id` returns not found
- Restore and unarchive happy paths

Uses `vi.mock()` to stub repository and audit service dependencies.

**Why:** Guide note protection is a hard product invariant. A regression that
allowed trashing the guide note would break the retrieval model.

---

### `write_proposal_service.test.ts`

Covers the proposal service trust rules:
- `read_only` connections cannot create proposals
- Proposals targeting notes outside allowed boxes are rejected
- Trashed note targets return not found
- Missing required fields throw descriptive errors
- Approval and rejection guards (must be pending, must belong to workspace)

Uses `vi.mock()` to stub all DB dependencies.

**Why:** Write proposals are the trust boundary between external AI agents and
the human-owned knowledge base. These rules must not regress.

---

### `import_vocabulary.test.ts`

Covers the import vocabulary validation logic:
- All 10 canonical `relationship_type` values are accepted
- Non-canonical relationship types return null (link skipped, warning issued)
- All 6 canonical `read_hint` values are accepted
- Non-canonical read hints return null (note created without hint, warning)
- Null/undefined/empty string inputs return null

**Why:** The import service is the main path through which external package
content enters the knowledge base. Vocabulary validation prevents DB constraint
violations and ensures imported data is semantically consistent.

---

### `rate_limit.test.ts`

Covers the in-memory sliding window rate limiter:
- First request within limit is allowed
- Requests up to the limit are allowed
- Requests beyond the limit are blocked with `retryAfter > 0`
- Separate counters per key (no cross-contamination)
- Window resets after the window duration expires
- `purgeExpiredEntries` removes stale entries

**Why:** The rate limiter is a critical abuse resistance control. Its logic must
be correct before it is deployed at API entry points.

---

### `markdown_render.test.ts`

Covers the markdown rendering and sanitization pipeline:
- Standard markdown elements render correctly (headings, bold, italic, code)
- XSS vectors are stripped: `<script>`, event handlers, `javascript:` hrefs,
  `<iframe>`, `<style>`, `<object>`, `<embed>`
- Safe content (https links, https images) is preserved
- Error resilience: returns fallback HTML without throwing on failures

**Why:** The `renderMarkdown` function is the shared rendering seam used
everywhere notes are displayed. Sanitization protects against stored XSS from
imported content.

---

## Test architecture

### Framework

[Vitest](https://vitest.dev/) — chosen for native TypeScript support, fast
execution, and built-in mocking via `vi.mock()`.

### Path aliases

The vitest config resolves `@/` to `src/` to match the Next.js TypeScript path
mapping. No additional setup is required.

### Mocking strategy

Services that depend on Supabase clients are tested by mocking the repository
layer with `vi.mock()`. This keeps tests fast (no network) and focused on
business logic.

Repository files are mocked entirely — individual mock return values are set
with `vi.mocked(...).mockResolvedValue(...)` per test or in `beforeEach`.

Audit service calls are mocked as no-ops since audit events are fire-and-forget
and their behavior is covered by the audit events design rather than unit tests.

---

## Intentional gaps (V1 deferrals)

The following are not unit-tested in V1 and are explicitly deferred:

| Gap | Reason for deferral |
|---|---|
| Integration tests with real DB | Requires test Supabase instance; deferred to post-launch hardening |
| Context bundle assembly correctness | Requires DB fixtures; complex to mock correctly |
| Version history and rollback | Depends on atomic SQL RPCs; needs DB integration tests |
| Import collision modes end-to-end | Complex DB state; needs integration test harness |
| Canonical API route integration tests | Needs full Next.js test harness or real DB; deferred |
| MCP adapter tool input validation | Covered by TypeScript types + canonical API tests; deferred |
| E2E browser tests | No Playwright/Cypress setup in V1; post-launch |

### How to add integration tests in a future pass

1. Set up a dedicated Supabase test project (or use branching)
2. Apply migrations: `npx supabase db push --db-url $TEST_DB_URL`
3. Write integration tests in `src/tests/integration/` using the real Supabase
   client and actual SQL functions
4. Add `test:integration` script to package.json

---

## Coverage targets (V1)

| Area | Target |
|---|---|
| API response envelope | 100% |
| Token format validation | 100% |
| Lifecycle guard logic | Key invariants (guide note protection, status checks) |
| Write proposal trust rules | Permission and ownership checks |
| Import vocabulary validation | All canonical values + non-canonical inputs |
| Rate limiter | Core window logic |
| Markdown sanitization | Key XSS vectors |

Full line coverage is not the goal. Covering the **trust invariants** is.
