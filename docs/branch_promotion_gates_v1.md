# Branch promotion gates — v1

Workspace admins can register HTTP webhooks that run before a draft branch
is promoted to main. Each gate returns `pass` or `fail`; any gate that
fails vetoes the promotion. This is a lightweight CI/CD-style gating
layer — think "run tests before merging to main" but for Context Store
branches.

## Why gates exist

Context Store's built-in promote flow already blocks the common failure
modes (conflicts, empty heads, concurrent promotes). But a workspace may
want to run *external* checks before letting a branch land:

* Run linting / integration tests against the branch diff.
* Require a human approval from a separate system.
* Confirm there is no ongoing incident before touching main.
* Emit an audit event into an external system before the branch is
  merged.

Gates let workspace admins plug any of these in without modifying the
Context Store codebase.

## Schema

Migration: `supabase/migrations/20260414000006_branch_promotion_gates.sql`.

### `branch_promotion_gates`

| Column             | Type         | Notes                                                |
| ------------------ | ------------ | ---------------------------------------------------- |
| `id`               | uuid         | Primary key.                                         |
| `workspace_id`     | uuid         | FK → `workspaces`. Scopes everything else.           |
| `name`             | text         | Display name. Unique per workspace.                  |
| `webhook_url`      | text         | Full HTTPS URL. Loopback hosts rejected.             |
| `secret`           | text         | 32-byte server-generated secret, hex-encoded.        |
| `timeout_seconds`  | integer      | 1..60; default 10.                                   |
| `status`           | text         | `active` or `disabled`.                              |
| `created_by`       | uuid         | FK → `auth.users`.                                   |
| `created_at`       | timestamptz  | Row insertion.                                       |
| `updated_at`       | timestamptz  | Maintained by trigger.                               |

RLS: members can SELECT; admins can INSERT / UPDATE / DELETE.

### `branch_promotion_gate_runs`

| Column           | Type         | Notes                                             |
| ---------------- | ------------ | ------------------------------------------------- |
| `id`             | uuid         | Primary key.                                      |
| `gate_id`        | uuid         | FK → `branch_promotion_gates`.                    |
| `branch_id`      | uuid         | FK → `draft_branches`.                            |
| `status`         | text         | `pending` → `passed` / `failed` / `error` / `timeout`. |
| `response_body`  | text         | Up to ~8KB of the webhook response.              |
| `duration_ms`    | integer      | Wall-clock dispatch → terminal status.            |
| `created_at`     | timestamptz  | Insertion time.                                   |

RLS: workspace members can SELECT. Writes go through the service-role
admin client inside the promote action.

## Webhook contract

### Request

Every active gate receives one POST per promote attempt (or manual run
from the branch detail page). Body:

```json
{
  "branch_id": "uuid",
  "branch_name": "feature/my-branch",
  "diff_summary": {
    "head_count": 3,
    "pending_op_count": 0,
    "folder_override_count": 1,
    "placement_change_count": 0,
    "created_note_link_count": 0,
    "created_attachment_count": 0,
    "changed_objects": [
      { "object_type": "note", "display_name": "Runbook" },
      { "object_type": "file", "display_name": "handler.ts" }
    ]
  },
  "timestamp": "2026-04-17T00:00:00.000Z"
}
```

Headers:

* `Content-Type: application/json`
* `X-ContextStore-Signature: v1=<hex>` — HMAC-SHA256, see below.
* `X-ContextStore-Timestamp: <iso-8601>` — duplicate of `body.timestamp`,
  included for convenience so verifiers don't have to parse JSON to find it.

### Response

The webhook returns JSON:

```json
{ "status": "pass" }
```

or

```json
{ "status": "fail", "reason": "integration tests failed" }
```

The `reason` field is optional and is surfaced verbatim in the branch
detail UI. Any of these make the gate fail:

* HTTP status is not 2xx.
* Body is not valid JSON.
* `status` is missing or is not the literal string `"pass"`.
* The webhook does not respond within `timeout_seconds` (recorded as
  `timeout`).
* Network / DNS / TLS error (recorded as `error`).

### Signature verification

The signing string is:

```
${timestamp}.${JSON.stringify(body)}
```

Exact replication of what Context Store sends:

```js
const signingInput = `${req.headers['x-contextstore-timestamp']}.${rawBody}`
const expected = crypto
  .createHmac('sha256', process.env.GATE_SECRET)
  .update(signingInput)
  .digest('hex')
if (`v1=${expected}` !== req.headers['x-contextstore-signature']) {
  return res.status(401).end()
}
```

Notes:

* **Use the raw body**. JSON-reserialise safety varies by platform; if
  your framework mutates the body before you see it, capture the raw
  bytes separately (e.g. `express.raw()` or a middleware).
* **Replay protection is on the verifier**. Context Store does not
  de-duplicate, because a retry during a transient error is a legal
  behaviour. Reject requests whose `timestamp` is more than a few
  minutes old if you care.

## Admin UI

Route: `/app/settings/workspace/promotion_gates`.

Gated by `requireAdminRole()`. Lists every gate in the workspace with a
status badge + "passed / failed" count from the most recent 5 runs.

Per-gate actions:

* **Edit** — name, webhook URL, timeout.
* **Disable / Enable** — flip status without deleting history.
* **Rotate secret** — regenerate; returns a new 64-char hex secret,
  shown once.
* **Delete** — drops the gate and its run history.

Secret display: any operation that produces a secret (create, rotate)
opens a dedicated dialog with a banner "This is the only time you will
see this secret" and a copy-to-clipboard button. Dismissing the dialog
forgets the secret; refreshing the page cannot re-show it.

## Promote integration

In `promoteBranch` (`src/server/services/branch_service.ts`):

1. The existing CAS guard moves `draft_branches.status` from `open` →
   `promoting`.
2. If `options.skip_gates` is false (default) and the workspace has any
   active gates, `runGates` fires them all in parallel.
3. If any gate fails / errors / times out, the status is rolled back to
   `open` and the promote throws `GatePromotionError` with the failed
   gate list. **No change set is opened**, so there is no aborted change
   set sitting in history.
4. On `allPassed=true`, the normal change-set flow runs.

`PromoteBranchResult.gateRuns` carries the pass/fail matrix so the
action layer can echo it back to the UI, and `PromoteBranchResult.gatesSkipped`
is `true` when an admin override bypassed the gates.

### Admin override (`skip_gates`)

Admins can pass `{ skip_gates: true }` to `promoteBranchAction` to
bypass gates. The branch promote still records the event as
`branch.promoted` *plus* a second `branch.promotion_gates_skipped`
audit event so the override is auditable.

Use sparingly — the typical unblock path is to disable the gate and
re-promote, which leaves a cleaner audit trail.

## Branch detail UI

When a branch detail page is loaded for a workspace with any active
gates, the `Promote` button opens a "Run promotion gates" panel instead
of the normal confirm dialog. The panel:

* Lists the active gates and a "Run gates" button.
* On click, invokes `runPromotionGatesAction` which calls `runGates` —
  the same code path as the real promote.
* Renders each gate's pass/fail badge with the `response_body` preview.
* The "Proceed to promote" button is enabled only after a run where
  every gate passed.

The panel is scoped minimally and lives beside the existing promote
confirmation dialog so the file stays small for parallel edits.

## Files touched

* `supabase/migrations/20260414000006_branch_promotion_gates.sql`
* `src/server/services/branch_promotion_gate_service.ts`
* `src/server/services/branch_service.ts` (promote integration)
* `src/app/app/branches/actions.ts` (action wiring)
* `src/app/app/settings/workspace/promotion_gates/` (admin UI)
* `src/app/app/branches/[branch_id]/branch_detail_client.tsx` (minimal panel)
* `src/tests/unit/branch_promotion_gates.test.ts`
* `docs/branch_promotion_gates_v1.md` (this file)
