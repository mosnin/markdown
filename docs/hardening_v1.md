# Hardening — Phase 4

This document records all hardening changes applied in the Phase 4 pass (2026-04-11)
after the expanded object model (Phase 3) was committed.

Phase 4 does **not** add product features. It hardens validation, security,
observability, and test coverage for the full expanded model.

---

## Test coverage expansion

Four new unit test modules covering the expanded object model:

### `object_lifecycle_guards.test.ts`

Status transition guards and ownership enforcement for Files, Skills, Agents.
Mirrors `lifecycle_guards.test.ts` for Notes. 28 tests.

Key patterns:
- `vi.mock("@/server/repositories/box_repository")` with explicit `beforeEach`
  setup of `getBoxById` mock — required because lifecycle service imports
  `getBoxById` for the two-hop ownership check on box-local objects
- Box-local objects (file, skill with `box_id` set) trigger two-hop check
- Reusable objects (`is_reusable: true`, `box_id: null`) skip box hop directly

### `object_rollback_safety.test.ts`

Version history rollback safety for all three object types. Verifies:
- Ownership enforcement at the service boundary
- Version identity (version must belong to the object)
- Immutability invariant (rollback creates a new version row via RPC)
- `listObjectVersions` uses `.order().range()` — not `.limit().offset()`

### `object_proposal_protection.test.ts`

`createProposal` trust rules for object types. Covers:
- Permission mode gating
- Box-local scope: must be in `allowedBoxIds`
- Reusable scope bypass: `is_reusable = true` objects accessible regardless of box scope
- Trashed rejection
- Required field validation for `update_*` proposals

### `object_trust_policy.test.ts`

Pure logic tests for `connectionCanDirectlyWrite()` and `describeObjectTrustLevel()`.
No DB mocking. Confirms the "proposals-only for all non-note types" invariant and
the "proposals-only for reusable objects in all modes" invariant.

---

## API hardening

### Rate limiting wired into write mutation routes

Previously, `src/lib/api/rate_limit.ts` existed but was not called by any route.
Rate limiting is now enforced at the two highest-risk mutation endpoints:

- `POST /api/v1/write_proposals` — `apiWriteLimit` (20/min per connection)
- `POST /api/v1/generated_notes` — `apiWriteLimit` (20/min per connection)

Both return HTTP 429 with `error_code: "rate_limited"` and a `Retry-After`
value in seconds when the limit is exceeded.

New response helper added: `E_RATE_LIMITED(retryAfterSeconds: number)` in
`src/lib/api/response.ts`.

### Object proposals in canonical API

`POST /api/v1/write_proposals` previously only accepted note proposal types.
It now accepts all object proposal types:

```
"update_file" | "create_skill" | "update_skill" | "create_agent" | "update_agent"
```

Object proposals accept `target_object_id` instead of `target_note_id` /
`target_folder_id`. The route routes to the correct `CreateObjectProposalInput`
branch in the service.

### Error message sanitization

`E_NOT_FOUND` and `E_FORBIDDEN` responses in the write_proposals and
generated_notes routes no longer echo internal service error messages to
the client. Instead:

- `E_NOT_FOUND`: returns `"The requested resource was not found"`
- `E_FORBIDDEN`: returns `"Connection does not have access to this resource"`

Service-layer messages (e.g. "not in an allowed box") are used only for
routing the error to the correct HTTP status — not returned to the caller.

### Internal error logging

`E_INTERNAL` fallbacks in API route handlers now include `console.error(...)`
for server-side observability without exposing details to the client.

---

## Server action hardening

All lifecycle server actions (archive, unarchive, trash, restore, rollback) for
Files, Skills, and Agents now include an `assertNonEmptyId` guard before
calling the service layer. This rejects blank or whitespace-only ID strings
before any auth or DB calls are made.

Files updated:
- `src/app/app/files/lifecycle_actions.ts`
- `src/app/app/skills/lifecycle_actions.ts`
- `src/app/app/agents/lifecycle_actions.ts`

---

## Known deferred items

These items were assessed and explicitly deferred to post-launch:

| Item | Reason deferred |
|---|---|
| Distributed rate limiting (Vercel KV) | Private beta; single-workspace usage bounded |
| DB-level integration tests | Requires test Supabase instance |
| E2E tests (Playwright) | No test infrastructure set up in V1 |
| Source content size limit in service layer | API route enforces 500KB; service layer relies on this |
| Realtime reconnection hardening | Supabase realtime already handles reconnect; UI has fallback refresh |
| N+1 query optimization on skills/agents library | Observed but not measured; no user-visible perf issue at beta scale |
| Nonce-based CSP | Requires per-request nonce infrastructure; V2 target |

---

## Verification

After Phase 4:

- Tests: 209/209 passing (18 test files)
- New test files: 4 (all unit, zero DB dependencies)
- Files modified: ~15
- Files created: 1 (this document)
