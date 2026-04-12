# Version History V1

Every note in Context Store accumulates an immutable chain of versions. This document describes the version model, diff_summary semantics, rollback rules, and what is and is not available to external tools in V1.

---

## Core principle

History is part of the trust layer, not a developer feature.

When a machine proposes a change and a human approves it, that approval creates a version. When an import replaces a note, a version is created. When a human rolls back to a prior state, that rollback itself creates a version. No version row is ever mutated or deleted — the chain grows in one direction only.

---

## Version model

Each `note_versions` row is a complete snapshot of a note at one point in time.

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Stable identity |
| `note_id` | uuid | Owning note (FK, CASCADE on note delete) |
| `parent_version_id` | uuid | Previous version in chain (NULL for initial) |
| `version_number` | integer | Monotonically increasing within a note, starting at 1 |
| `title` | text | Title snapshot at this version |
| `markdown_content` | text | Full content snapshot |
| `content_bytes` | integer | `octet_length(markdown_content)` |
| `actor_type` | text | `user`, `connection`, or `system` |
| `actor_id` | text | UUID of the user or connection |
| `change_origin` | text | How this version came to exist — see below |
| `diff_summary` | jsonb | Lightweight change description — see below |
| `diff_patch` | text | Reserved for full unified diff (nullable) |
| `created_at` | timestamptz | Immutable write time |

### change_origin values

| Value | Meaning |
|---|---|
| `human_edit` | Created by a human via the editor |
| `import` | Created by the import service |
| `generated` | Created directly by a `generate_in_allowed_folders` connection |
| `proposal_approved` | Created when a human approved a write proposal |
| `rollback` | Created by rolling back to a prior version |
| `promotion` | Created when a human promotes a generated note to a standard note; same content as previous version |

---

## diff_summary

`diff_summary` is a deterministic, lightweight jsonb field computed in the TypeScript service layer before calling the SQL function. It describes what structurally changed between the previous note state and the new snapshot.

### Schema

```json
{
  "title_changed":   boolean,
  "body_changed":    boolean,
  "summary_changed": boolean,
  "tags_changed":    boolean,
  "status_changed":  boolean,
  "bytes_added":     integer,
  "bytes_removed":   integer
}
```

`bytes_added` and `bytes_removed` are mutually exclusive: only one is non-zero per version. Both can be zero if content_bytes did not change.

`tags_changed` uses order-insensitive comparison.

### Which flows produce diff_summary

| Flow | diff_summary populated |
|---|---|
| Human edit via editor | Yes — `note_service.updateNote` computes it |
| Human note creation | NULL (no prior state to diff against) |
| Rollback | Yes — `version_history_service.rollbackNoteToVersion` computes it |
| Import (create) | NULL (initial version, no prior state) |
| Import (update/replace) | Deferred — see tradeoffs |
| Proposal approval (update/append/replace) | Deferred — see tradeoffs |
| Generated note creation | NULL (initial version) |

---

## Version history list behavior

`listVersionsForNote` returns versions ordered newest first (descending version_number). All versions are returned — rollback, proposal_approved, and generated origins are not filtered. The caller receives `is_current: boolean` indicating whether each version is the active state.

Page size is bounded (default 50, max 100 in the canonical API endpoint).

---

## Rollback algorithm

Rollback is human-only. It is not available through the canonical API or MCP.

**Steps:**

1. `version_history_service.rollbackNoteToVersion` verifies note ownership (note → box → workspace_id)
2. Loads target version, verifies `target_version.note_id === noteId`
3. Computes `diff_summary` comparing current note state to the target snapshot
4. Calls `rollback_note_to_version` SQL function via admin client:
   - `SELECT ... FOR UPDATE` on note row — prevents concurrent version races
   - `SELECT ... WHERE id = p_target_version_id AND note_id = p_note_id` — ownership verified inside the transaction
   - Inserts new `note_versions` row:
     - `parent_version_id = note.current_version_id` (points to the version being rolled back from)
     - `version_number = MAX(version_number) + 1` — always grows
     - `change_origin = 'rollback'`
     - `actor_type = 'user'`, `actor_id = userId`
     - `title`, `markdown_content`, `content_bytes` copied from target snapshot
   - `UPDATE notes SET title, markdown_content, content_bytes, current_version_id = new_version.id`
5. Reloads the updated note
6. Fires `note.rollback` audit event (fire-and-forget)

**Immutability guarantee:** The target historical version row (`p_target_version_id`) is never touched. The rollback is a brand new version that happens to contain the same content.

---

## Ownership checks

### Human app (version list + rollback)

`version_history_service` enforces the two-hop check before any data is returned or mutated:

```
note → box → workspace_id === ctx.workspace.id
```

If the note is not found or the workspace does not match, a `"Note not found"` error is thrown — identical to what the caller would see for a truly missing note (no information leakage).

Rollback additionally verifies the target version belongs to the note (both in the service layer and inside the SQL function).

### Canonical API (version list)

`GET /api/v1/notes/[id]/versions` verifies:
1. Connection bearer token is valid
2. `note.box_id ∈ connection.allowedBoxIds`
3. `box.workspace_id === connection.workspaceId` (defense in depth)

---

## Canonical API

### `GET /api/v1/notes/[note_id]/versions`

Returns paginated version history. `markdown_content` is excluded from list items to keep the payload bounded. Use `GET /api/v1/notes/[id]` for the current full content.

**Query parameters:** `limit` (default 50, max 100), `page` (1-based)

**Response `data`:**

```json
{
  "note_id": "...",
  "current_version_id": "...",
  "versions": [
    {
      "id": "...",
      "note_id": "...",
      "parent_version_id": "...",
      "version_number": 5,
      "title": "...",
      "content_bytes": 1024,
      "actor_type": "user",
      "actor_id": "...",
      "change_origin": "human_edit",
      "diff_summary": { "body_changed": true, "bytes_added": 42, ... },
      "created_at": "..."
    }
  ],
  "total_fetched": 5,
  "limit": 50,
  "page": 1
}
```

### Rollback is not in the canonical API

Rollback is intentionally not available to external connections in V1. Reasons:

1. Rollback modifies the user's source of truth. The whole trust model is built around external tools proposing changes and humans approving them.
2. A connection rolling back a note would bypass the proposal review step — a human never saw or approved the change.
3. If a connection needs to correct a generated or proposal-approved note, the right path is to submit a new write proposal with the corrected content.

This boundary may be revisited in a future prompt with explicit authorization controls.

---

## MCP

No version history or rollback tools are exposed through MCP in V1.

The `GET /api/v1/notes/[id]/versions` endpoint exists and could be wrapped as a `list_note_versions` tool cleanly. This was deferred because:
1. The immediate value is limited — external tools are better served by reading the current note via `get_note`
2. Keeping MCP conservative reduces surface area while the history model stabilizes
3. The endpoint is there; MCP can be extended with a single tool registration when there is a clear use case

---

## Object versions — Files, Skills, Agents

Files, Skills, and Agents use a separate shared `object_versions` table (not `note_versions`). The schema and immutability contract are identical:

- Each row is a complete snapshot of `source_content` at one point in time
- Rows are INSERT-only; no updates or deletes
- `change_origin` values: `human_edit`, `import`, `generated`, `proposal_approved`, `rollback`
- `actor_type` / `actor_id` track who made the change
- Rollback creates a new version row; it never rewrites history

The `version_history_service.ts` module provides:

```
listVersionsForObject(supabase, workspaceId, objectType, objectId)
getVersionForObject(supabase, workspaceId, objectType, objectId, versionId)
rollbackObjectToVersion(supabase, userId, workspaceId, objectType, objectId, targetVersionId)
```

Ownership for box-local objects uses the two-hop check (object → box → workspace_id). Ownership for reusable workspace objects is checked directly via workspace_id.

**Rollback exception for reusable objects:** A human owner rolling back a reusable shared skill or agent bypasses the "proposal-only" rule for external writes. This is the deliberate exception — the owner is explicitly restoring a known-good state. The rollback is audited with `change_origin = 'rollback'` and `actor_type = 'user'`.

UI: `ObjectHistoryPanel` + `HeterogeneousVersionTimeline` (collapsible, shows version count in header).

---

## What is NOT available in V1

- Rollback through the canonical API or MCP
- Version content diff through the API (full content is available per-version in the human app)
- Version deletion or amendment
- Cross-note or cross-object history comparison
- Audit browsing UI with version detail

---

## Files

| Layer | File | Purpose |
|---|---|---|
| Migration | `supabase/migrations/20260409000006_version_history_rpc.sql` | Extend change_origin constraint; add diff_summary param to update RPC; add rollback_note_to_version |
| Constant | `src/server/domain/constants/audit_constants.ts` | Added `ROLLBACK` to `CHANGE_ORIGIN` |
| Repository | `src/server/repositories/note_version_repository.ts` | Added `getVersionByNoteAndId` |
| Helper | `src/server/services/diff_utils.ts` | `computeDiffSummary`, `computeRollbackDiff` |
| Service | `src/server/services/version_history_service.ts` | `listVersionsForNote`, `getVersionForNote`, `rollbackNoteToVersion` |
| Audit | `src/server/services/audit_service.ts` | Added `auditNoteRollback` |
| Note service | `src/server/services/note_service.ts` | `updateNote` now computes and passes `diff_summary` |
| API route | `src/app/api/v1/notes/[note_id]/versions/route.ts` | `GET` — paginated version list (connection-authenticated) |
| Server action | `src/app/app/notes/[note_id]/actions.ts` | `rollbackNoteAction` — human only |
| Component | `src/components/product/note_history_panel.tsx` | Version list + detail + rollback confirm UI |
| Note page | `src/app/app/notes/[note_id]/page.tsx` | Added History tab |

## Extension: change-set correlation (v1.1)

Every version row now carries a nullable `change_set_id` pointing at
the `change_sets` row that produced it. The underlying version graph is
unchanged — versions are still immutable, rollback still writes a new
version, `parent_version_id` still forms the linked list — but the
extra link lets the restore service walk from a grouped operation
(import, proposal approval, structural move, another rollback) to the
specific versions it produced, and back. See
[`docs/rollback_architecture_v1.md`](rollback_architecture_v1.md) for
the full model.

The human-only rollback action (`rollbackNoteToVersion`) is also
wrapped by `restoreNoteVersion` in
`src/server/services/restore_service.ts`, which opens a
`origin: 'rollback'` change set around the existing call and tags the
new version with the change set id. Direct callers of
`rollbackNoteToVersion` continue to work unchanged.

## Extension: file / skill / agent rollback wrapped in change sets (v1.2)

`restore_service.restoreObjectVersion(workspaceId, actorId,
objectType, objectId, versionId)` wraps `rollbackObjectToVersion` in
an `origin: 'rollback'` change set, records a single
`change_set_item` with the before / after version ids, and tags the
new `object_versions` row with `change_set_id`. Semantics are
identical to `restoreNoteVersion`. See
[`docs/rollback_schema_and_restore_engine_v1.md`](rollback_schema_and_restore_engine_v1.md)
for the full story.
