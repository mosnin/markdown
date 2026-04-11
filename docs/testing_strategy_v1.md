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

Unit tests live in `src/tests/unit/`. Integration tests live in
`src/tests/integration/`. The vitest configuration is at `vitest.config.ts`.

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

### `rollback_safety.test.ts`

Covers version history service rollback safety invariants:
- Ownership: note from wrong workspace → throws "not found"
- Not-found: missing note → throws "not found"; missing version → "Version not found"
- Immutability: rollback creates a new version; target version only read, never mutated
- `is_current` flag: correctly reflects `current_version_id` across both list and get paths
- Audit event fired on successful rollback

**Why:** Rollback is the only destructive-to-history action a human can take.
The immutability invariant (history is never rewritten) must never regress.

---

### `note_update_safety.test.ts`

Covers the `updateNote` service for autosave safety:
- Content stored verbatim: RPC receives exact title and markdownContent strings
- Optional fields default correctly: null summary, empty tags, null readHint when omitted
- Diff computed from the *old* note state before overwrite — not from post-update values
- Null diff when current note is missing (graceful, not thrown)
- diff_summary value forwarded verbatim to the RPC call
- RPC error propagated as thrown Error with message
- Audit event fired after successful update

**Why:** Autosave is the highest-frequency write path. Confirming that content
is not transformed and that the diff is computed correctly from prior state
protects against silent data corruption and misleading diff_summary values.

---

### `context_bundle_assembly.test.ts`

Covers the context bundle assembly service inclusion and exclusion rules:
- Ownership: missing note → "Note not found"; wrong workspace box → "Not found"
- Target self-exclusion: target note never appears in linked_notes
- Trashed linked notes always excluded
- Archived linked notes excluded by default; included with `includeArchived: true`
- Guide note never duplicated in linked_notes even when also a linked candidate
- Guide note excluded when it is the same note as the target
- Linked limit capped at 10; `truncation_reason: "linked_limit_reached"` populated
- Relationship ranking: `depends_on` (score 1) before `related` (8) before `sibling_of` (9)
- Cross-box notes excluded from linked_notes
- Ancestor summary: `truncation_reason: "ancestor_summary_not_found"` for root-level notes

**Why:** The context bundle is the primary retrieval package for external AI
consumers. Inclusion/exclusion bugs would silently deliver wrong context.

---

---

### `object_lifecycle_guards.test.ts`

Covers lifecycle status-transition guards for the expanded object model (Files,
Skills, Agents) matching the pattern of `lifecycle_guards.test.ts` for Notes:

- Status transitions: cannot archive already-archived; cannot trash already-trashed
- Trashed → archive blocked; only trashed → restore is allowed
- Ownership enforcement: wrong `workspace_id` → "not found"
- Not-found: missing object → throws
- Box-local two-hop ownership: `getBoxById` mock verifies box belongs to workspace
- Reusable objects skip box hop (no `box_object_attachments` side-effects on archive/trash)

Uses `vi.mock("@/server/repositories/box_repository")` with explicit
`vi.mocked(boxRepo.getBoxById).mockResolvedValue(...)` in `beforeEach`.

**Why:** The expanded object model reuses the same lifecycle service. Verifying
the guard logic across all three object types ensures no type-specific branches
were missed.

---

### `object_rollback_safety.test.ts`

Covers version history rollback safety for Files, Skills, Agents:

- Ownership: wrong workspace → "not found"; object missing → "not found"
- Version identity: version not belonging to object → "Version not found"
- Immutability: rollback calls RPC and returns `new_version_id ≠ target_version_id`
- All three object types (file/skill/agent) exercise the same RPC path
- RPC error propagated as thrown Error

**Why:** Objects use the same `rollback_object_to_version` RPC as notes.
Confirming the immutability invariant and ownership checks hold for all types.

---

### `object_proposal_protection.test.ts`

Covers `createProposal` for object types (file/skill/agent proposals):

- `read_only` connection → throws "permission"
- `propose_writes` and `generate_in_allowed_folders` → allowed
- Box-local skill not in allowed box → throws "allowed box"
- Reusable skill/agent (box_id=null) → allowed regardless of box scope
- Trashed target → throws "trashed"
- Missing target_object_id for update proposals → throws "target_object_id"
- Object proposals do not require note-specific fields

**Why:** The proposal system is the trust boundary for all external writes.
Verifying it correctly distinguishes object vs note proposals and enforces
reusable object scoping rules.

---

### `object_trust_policy.test.ts`

Pure logic tests for `connectionCanDirectlyWrite()` and `describeObjectTrustLevel()`:

- `read_only` / `propose_writes`: always `false` regardless of object type
- `generate_in_allowed_folders`: `true` only for box-local notes; `false` for all
  files/skills/agents and all reusable objects
- Reusable skills/agents: `false` across all three permission modes
- `proposal_only_for_external` invariant: always `true` for all policy objects
- `describeObjectTrustLevel`: correct labels ("Box file", "Box skill", "Box agent",
  "Workspace shared") for all object types

**Why:** The trust policy is a pure-logic service. Zero DB mocking needed.
Confirms the "proposals only" invariant holds at the policy layer.

---

## Integration test modules

Integration tests live in `src/tests/integration/`. They mock the **repository
layer** (not the DB) but run the full service function, verifying the complete
guard chain, correct mock call sequences, and legible error messages.

### `proposal_conflict_detection.test.ts`

Covers the write proposal conflict detection path:
- SQL RPC returning `outcome: "conflicted"` → service returns `{ outcome, reason }` with no note
- Conflict fires `auditWriteProposalConflicted`, not `auditWriteProposalApproved`
- Approval happy path: `outcome: "approved"`, note returned, correct audit event
- Ownership guard: proposal from a different workspace → `not found`
- Idempotency: already-approved or conflicted proposal → `not pending`

**Why:** The two-outcome RPC result is the version-conflict detection seam.
Verifying the service interprets both outcomes correctly (different audit events,
different return shapes) is essential for the AI agent trust model.

---

### `generated_note_authorization.test.ts`

Covers the four-layer authorization chain in `createGeneratedNote`:
- Wrong `permission_mode` (read_only, propose_writes) → throws "generate_in_allowed_folders"
- Non-existent or trashed folder → throws "not found"
- Folder's box not in `allowedBoxIds` → throws "not in an allowed box"
- `accepts_generated_notes = false` → throws "accepts_generated_notes"
- All checks pass → RPC called with correct params, note returned with `is_generated: true`

**Why:** Generated notes are the highest-privilege external operation. Defense-in-
depth at the service level ensures the auth chain holds even if a route handler
skips a check.

---

### `stable_id_resolution.test.ts`

Covers the UUID-as-identity invariant:
- `getNoteById` is called with the note UUID, never with `path_cache` values
- A note with a changed `path_cache` (after a move) is still found by original UUID
- UUID identity is stable across multiple operations on the same note

**Why:** `path_cache` is a derived display field. Verifying that service
functions never use it as a lookup key prevents a class of subtle identity bugs
after note moves.

---

### `lifecycle_guide_protection.test.ts`

Covers the end-to-end guide note protection flow:
- Guide note cannot be archived or trashed (Supabase query detects assignment)
- Non-guide note in the same box can be archived or trashed
- Former guide note (assignment cleared) can be trashed after the fact
- Already-archived note → `already archived`; already-trashed → `already trashed`
- Archived-to-trashed direction → `Cannot archive a trashed note`
- Restore and unarchive happy paths return `status: "active"`
- Restore on active note → `not trashed`

**Why:** Guide note protection is a hard system invariant. The integration test
verifies the guard survives the full call chain including the supabase mock query.

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

The following are not covered in V1 and are explicitly deferred:

| Gap | Reason for deferral |
|---|---|
| DB-level integration tests | Requires test Supabase instance; deferred to post-launch hardening |
| Import collision modes end-to-end | Complex DB state; needs DB integration test harness |
| Canonical API route integration tests | Needs full Next.js test harness or real DB |
| MCP adapter tool input validation | Covered by TypeScript types + canonical API tests |
| E2E browser tests | No Playwright/Cypress setup in V1; post-launch |

### How to add DB integration tests in a future pass

1. Set up a dedicated Supabase test project (or use branching)
2. Apply migrations: `npx supabase db push --db-url $TEST_DB_URL`
3. Add a `TEST_DATABASE_URL` env var to the test environment
4. Write tests in `src/tests/integration/db/` using the real Supabase client
5. Add `test:db` script to package.json (separate from the mock-based suite)

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
| Proposal conflict detection (integration) | Conflict path + audit + approval happy path |
| Generated note authorization (integration) | All 4 auth checks in sequence |
| Stable ID resolution (integration) | UUID-as-identity invariant before/after move |
| Lifecycle guide protection (integration) | Full guard chain + idempotency + restore |
| Rollback safety (unit) | Ownership, version identity, immutability invariant |
| Note update safety (unit) | Content verbatim, diff from prior state, error propagation |
| Context bundle assembly (unit) | Ownership, exclusion rules, ranking, deduplication |

Full line coverage is not the goal. Covering the **trust invariants** is.

---

## Final state (2026-04-10)

All 14 test files pass. 138 tests pass. Zero failures. `pnpm test` exits 0.
`pnpm build` compiles clean. See `docs/release_candidate_report_v1.md`.
