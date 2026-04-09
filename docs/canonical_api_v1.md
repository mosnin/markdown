# Canonical API V1

The external HTTP API for Context Store. All endpoints live under `/api/v1` and require bearer token authentication.

---

## Authentication

All endpoints require:

```
Authorization: Bearer csk_v1_<64hex>
```

Tokens are issued through the **Connections** settings page. A connection scopes a bearer token to one or more boxes within a workspace.

### Token format

| Component | Value |
|---|---|
| Full token | `csk_v1_<64 hex chars>` |
| `token_prefix` | First 8 hex chars — used for fast DB lookup |
| `secret_hash` | `sha256(<64hex>)` — compared with constant-time equality |

Tokens are shown exactly once at creation/rotation time. The raw secret is never stored.

---

## Response envelope

### Success

```json
{
  "data": <response payload>,
  "meta": {
    "request_id": "uuid",
    "api_version": "v1"
  }
}
```

### Error

```json
{
  "error_code": "not_found",
  "message": "Note not found",
  "request_id": "uuid"
}
```

### Error codes

| Code | HTTP status | Meaning |
|---|---|---|
| `unauthorized` | 401 | Missing or invalid bearer token |
| `forbidden` | 403 | Valid token but insufficient scope for this resource |
| `not_found` | 404 | Resource does not exist or is trashed |
| `bad_request` | 400 | Malformed request body or missing required field |
| `method_not_allowed` | 405 | Wrong HTTP method for this endpoint |
| `internal_error` | 500 | Unexpected server error |

---

## Endpoints

### System

#### `GET /api/v1/system_guide`

Returns the static system guide: entity definitions, relationship types, retrieval rules, write rules.

Useful for AI clients that need to orient themselves before making other API calls.

**No path or query parameters.**

**Response `data`:**

```json
{
  "productName": "Context Store",
  "productDescription": "...",
  "storageHierarchy": [...],
  "entities": [...],
  "noteKinds": [...],
  "relationshipTypes": [...],
  "retrievalRules": [...],
  "writeRules": [...],
  "statusValues": [...]
}
```

---

### Boxes

#### `GET /api/v1/boxes`

Lists the boxes this connection has been scoped to access. Trashed boxes are excluded.

**Response `data`:** `Array<{ id, name, slug, description, guide_note_id, created_at, updated_at }>`

---

#### `GET /api/v1/boxes/[box_id]/box_guide`

Returns the guide note assigned to the box, or `null` if none is assigned.

**Response `data`:**

```json
{
  "box_id": "...",
  "guide_note": {
    "id": "...", "title": "...", "slug": "...", "path_cache": "...",
    "markdown_content": "...", "summary": "...", "tags": [...],
    "read_hint": "...", "kind": "guide", "status": "active",
    "updated_at": "...", "created_at": "..."
  } | null
}
```

---

#### `GET /api/v1/boxes/[box_id]/box_overview`

Returns the full hierarchy and link graph for the box.

Hard limits: 1000 nodes, 2000 edges. `truncated: true` when a limit was hit.

**Response `data`:**

```json
{
  "box": { "id", "name", "slug", "description", "guide_note_id" },
  "nodes": [
    {
      "id": "...", "kind": "folder" | "note", "label": "...", "path": "...",
      "noteKind": "note" | "guide" | "bundle" | undefined,
      "parentFolderId": "..." | null,
      "parentId": "..." | null
    }
  ],
  "edges": [
    { "id": "...", "sourceNoteId": "...", "targetNoteId": "...", "relationshipType": "...", "relationshipNote": "..." | null }
  ],
  "folder_count": 12,
  "note_count": 47,
  "edge_count": 18,
  "truncated": false
}
```

---

#### `GET /api/v1/boxes/[box_id]/folder_contents`

Lists folders and notes at a specific level of the box hierarchy. Trashed and archived content is excluded.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `folder_id` | string | — | Parent folder ID; omit for box root level |

**Response `data`:**

```json
{
  "box_id": "...",
  "folder_id": "..." | null,
  "folders": [
    { "id", "name", "slug", "path_cache", "description",
      "accepts_generated_notes", "parent_folder_id", "created_at", "updated_at" }
  ],
  "notes": [
    { "id", "title", "slug", "path_cache", "folder_id", "summary", "tags",
      "read_hint", "kind", "status", "updated_at", "created_at" }
  ]
}
```

---

### Notes

#### `GET /api/v1/notes/[note_id]`

Returns a single note by ID including full markdown body. Trashed notes are treated as not found.

The note's box must be in the connection's allowed scopes.

**Response `data`:**

```json
{
  "id": "...", "box_id": "...", "folder_id": "..." | null,
  "title": "...", "slug": "...", "path_cache": "...",
  "markdown_content": "...", "summary": "...", "tags": [...],
  "read_hint": "...", "kind": "note" | "guide" | "bundle",
  "status": "active" | "archived",
  "origin_type": "user_created" | "imported" | "generated_by_tool" | "duplicated" | "restored",
  "is_generated": true | false,
  "generated_by_connection_id": "..." | null,
  "created_at": "...", "updated_at": "..."
}
```

`is_generated` is `true` for notes created directly by a `generate_in_allowed_folders` connection that have not yet been promoted. `origin_type` and `generated_by_connection_id` are preserved after promotion.

---

#### `GET /api/v1/notes/[note_id]/linked_notes`

Returns all notes explicitly linked to or from the given note. Only linked notes in allowed box scopes are returned. Trashed linked notes are excluded.

**Response `data`:**

```json
{
  "note_id": "...",
  "links": [
    {
      "id": "...", "source_note_id": "...", "target_note_id": "...",
      "relationship_type": "related" | "depends_on" | "parent_of" | "child_of" | "reference_for" | "extends" | "example_of" | "sibling_of" | "supersedes" | "derived_from",
      "relationship_note": "..." | null,
      "direction": "outgoing" | "incoming",
      "created_at": "..."
    }
  ],
  "notes": [
    { "id", "box_id", "folder_id", "title", "slug", "path_cache",
      "summary", "tags", "read_hint", "kind", "status", "updated_at" }
  ]
}
```

---

#### `GET /api/v1/notes/[note_id]/versions`

Returns paginated version history for a note, newest first. All change origins are returned (human_edit, import, generated, proposal_approved, rollback).

`markdown_content` is excluded from list items to keep the payload bounded. Use `GET /api/v1/notes/[id]` for the current full content.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Max 100 |
| `page` | integer | 1 | 1-based page number |

**Response `data`:**

```json
{
  "note_id": "...",
  "current_version_id": "..." | null,
  "versions": [
    {
      "id": "...",
      "note_id": "...",
      "parent_version_id": "..." | null,
      "version_number": 5,
      "title": "...",
      "content_bytes": 1024,
      "actor_type": "user" | "connection" | "system",
      "actor_id": "...",
      "change_origin": "human_edit" | "import" | "generated" | "proposal_approved" | "rollback",
      "diff_summary": { ... } | null,
      "created_at": "..."
    }
  ],
  "total_fetched": 5,
  "limit": 50,
  "page": 1
}
```

**Note:** Rollback is not available through the canonical API. See `docs/version_history_v1.md` for the explanation.

---

#### `POST /api/v1/search_notes`

Full-text search within a box. Search is always box-scoped — cross-box search is not supported in V1.

**Request body:**

```json
{
  "box_id": "...",
  "query": "my search query",
  "limit": 20
}
```

| Field | Type | Default | Constraints |
|---|---|---|---|
| `box_id` | string | required | Must be in connection's allowed scopes |
| `query` | string | required | Empty string returns `[]` |
| `limit` | integer | 20 | Max 50 |

**Response `data`:**

```json
{
  "box_id": "...", "query": "...", "limit": 20,
  "results": [
    {
      "id", "box_id", "folder_id", "title", "slug", "path_cache",
      "summary", "tags", "read_hint", "kind", "status", "updated_at",
      "rank": 12.4
    }
  ]
}
```

Ranking is deterministic:
1. Exact title match (+4.0)
2. Title prefix match (+2.0)
3. ts_rank_cd FTS weighted score × 10 (title+tags=A, summary=B, body=C)
4. `retrieval_priority` nudge (0–1)
5. `updated_at` desc (tie-break)

---

#### `POST /api/v1/context_bundles`

Assembles a bounded, deterministic context bundle centered on a note. Includes the target note, guide note, linked notes, ancestor summary note, and relationship edges — ranked, deduplicated, and bounded.

**Request body:**

```json
{
  "note_id": "...",
  "include_guide": true,
  "include_ancestor_summary": true,
  "include_archived": false,
  "linked_limit": 10
}
```

| Field | Type | Default | Constraints |
|---|---|---|---|
| `note_id` | string | required | Must be accessible via connection scope |
| `include_guide` | boolean | `true` | Include box guide note if assigned |
| `include_ancestor_summary` | boolean | `true` | Walk folder chain for summary note |
| `include_archived` | boolean | `false` | Include archived linked notes |
| `linked_limit` | integer | 10 | Max 10 |

**Response `data`:** `ContextBundle` — see `src/server/domain/types/context_bundle.ts` for the full shape.

---

### Export

All export endpoints assemble the package server-side, upload it to private Supabase Storage, and return a signed download URL. The response is JSON in the standard `{ data, meta }` envelope.

The caller downloads the actual zip by GETting `data.signed_url` before it expires (1 hour).

**All export endpoints return the same `data` shape:**

```json
{
  "signed_url": "https://<project>.supabase.co/storage/v1/object/sign/exports/...",
  "expires_at": "2026-04-09T14:00:00.000Z",
  "filename": "my-note.zip",
  "size_bytes": 8192,
  "manifest_summary": {
    "export_type": "note" | "folder" | "box" | "bundle",
    "note_count": 1,
    "folder_count": 0,
    "link_count": 0
  }
}
```

Check `expires_at` before using the URL. Expired URLs return a storage error.

#### `POST /api/v1/export_note`

Exports a single note as a `.zip` package.

**Authentication:** Bearer token (connection auth). The note's box must be in the connection's allowed scope.

**Request body:** `{ "note_id": "..." }`

**Response `data`:** `ExportArtifact` (see shape above, `export_type: "note"`)

---

#### `POST /api/v1/export_folder`

Exports a folder and all its descendant folders and notes as a `.zip` package.

**Authentication:** Bearer token (connection auth). The folder's box must be in the connection's allowed scope.

**Request body:** `{ "folder_id": "..." }`

**Response `data`:** `ExportArtifact` (`export_type: "folder"`)

---

#### `POST /api/v1/export_box`

Exports an entire box (all active folders and notes) as a `.zip` package.

**Authentication:** Bearer token (connection auth). The box must be in the connection's allowed scope.

**Request body:** `{ "box_id": "..." }`

**Response `data`:** `ExportArtifact` (`export_type: "box"`)

---

#### `POST /api/v1/export_context_bundle`

Assembles a context bundle for a note and exports it as a `.zip` package.
The ZIP includes a manifest, individual note files, and a `README.md` with the suggested reading order.

**Authentication:** Bearer token (connection auth). The note's box must be in the connection's allowed scope.

**Request body:**

```json
{
  "note_id": "...",
  "include_guide": true,
  "include_ancestor_summary": true,
  "linked_limit": 10
}
```

**Response `data`:** `ExportArtifact` (`export_type: "bundle"`)

---

### Import

#### `POST /api/v1/import_package`

Imports a `.md` or `.zip` package into an owned box.

**Authentication:** Human session only (Supabase SSR cookie auth). External bearer token connections are **not** supported for import in V1.

Rationale: Import creates content from an external untrusted package at scale (up to 1,000 objects). Allowing connection-auth import would let any scoped connection flood a workspace with arbitrary content without human review. Human-initiated import keeps this operation explicitly deliberate.

A connection sending a bearer token to this endpoint receives `401 Unauthorized`.

**Request:** `Content-Type: multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | Yes | `.md` or `.zip`, max 25 MB |
| `box_id` | string | Yes | Target box UUID (must be owned by the authenticated workspace) |
| `collision_mode` | string | Yes | One of: `create_copy`, `replace_by_id`, `merge_metadata_only`, `remap_ids_and_import` |
| `target_folder_id` | string | No | Target folder UUID (must belong to the target box) |

**Supported package formats:**

| Input | Behavior |
|---|---|
| `.md` file | One note created; title from first H1 or filename |
| `.zip` without `manifest.json` | Each `.md` file becomes a note |
| `.zip` with `manifest.json` | Manifest drives folder/note/link creation |

**Response `data`:** `ImportSummaryReport`

```json
{
  "collision_mode": "create_copy",
  "created_counts": { "folders": 2, "notes": 5, "links": 3 },
  "replaced_counts": { "notes": 0, "folders": 0 },
  "duplicated_counts": { "notes": 0, "folders": 0 },
  "remapped_counts": { "notes": 0, "folders": 0 },
  "skipped_counts": { "notes": 0, "folders": 0, "links": 0 },
  "actions": [...],
  "warnings": [...]
}
```

**Hard failures (400):** Malformed zip, invalid manifest schema, unsupported collision mode, package > 25 MB, combined folder + note count > 1,000.

---

### Write proposals

#### `POST /api/v1/write_proposals`

Submit a write proposal. The connection must have `propose_writes` or `generate_in_allowed_folders` permission.

**Request body:**

```json
{
  "proposal_type": "create_note" | "update_note" | "append_note" | "replace_note",
  "target_folder_id": "...",
  "target_note_id": "...",
  "proposed_title": "...",
  "proposed_content": "...",
  "proposed_summary": "...",
  "proposed_tags": ["tag1", "tag2"],
  "rationale": "..."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `proposal_type` | enum | Yes | One of the 4 types above |
| `target_folder_id` | string | `create_note` only | Folder to create the note in |
| `target_note_id` | string | update/append/replace | Note to modify |
| `proposed_title` | string | Yes | Proposed note title |
| `proposed_content` | string | Yes | Full markdown body |
| `proposed_summary` | string | No | Proposed summary (optional metadata) |
| `proposed_tags` | string[] | No | Proposed tags (optional metadata) |
| `rationale` | string | No | Human-readable reason for the change; shown in review UI |

**Response `data` (201):**

```json
{
  "id": "...",
  "proposal_type": "...",
  "status": "pending",
  "proposed_title": "...",
  "rationale": "...",
  "created_at": "..."
}
```

**Errors:**

| Code | Meaning |
|---|---|
| `forbidden` | Connection is `read_only` |
| `bad_request` | Missing required fields or invalid proposal_type |
| `not_found` | target_note_id or target_folder_id not found / not in allowed scopes |

---

#### `GET /api/v1/write_proposals`

List proposals submitted by this connection.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter by status: `pending`, `approved`, `rejected`, `conflicted`, `canceled`, `expired` |
| `limit` | integer | 50 | Max 100 |
| `page` | integer | 1 | 1-based page number |

**Response `data`:**

```json
{
  "proposals": [
    {
      "id": "...",
      "proposal_type": "...",
      "status": "pending",
      "proposed_title": "...",
      "rationale": "...",
      "target_note_id": "..." | null,
      "target_folder_id": "..." | null,
      "approved_note_id": "..." | null,
      "approved_version_id": "..." | null,
      "review_note": "..." | null,
      "expires_at": "..." | null,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "total": 12,
  "limit": 50,
  "page": 1
}
```

---

### Generated notes

#### `POST /api/v1/generated_notes`

Create a note directly in an allowed folder. Requires `generate_in_allowed_folders` permission, and the target folder must have `accepts_generated_notes = true`.

This path is for high-confidence ingest output, structured summaries, or reference data that does not require human review.

Generated notes have `origin_type: "generated_by_tool"` and `is_generated: true`. They are fully visible in search, tree navigation, version history, and exports. The creating connection is identified by `generated_by_connection_id`.

**Request body:**

```json
{
  "folder_id": "...",
  "title": "...",
  "content": "...",
  "summary": "...",
  "tags": ["tag1", "tag2"],
  "read_hint": "generated"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `folder_id` | string | Yes | Must be in connection's allowed boxes and have `accepts_generated_notes = true` |
| `title` | string | No | Defaults to `<connection_name> YYYYMMDD_HHMMSS` (UTC) |
| `content` | string | Yes | Full markdown body |
| `summary` | string | No | Short summary |
| `tags` | string[] | No | Tags list |
| `read_hint` | string | No | Defaults to `"generated"` |

**Response `data` (201):**

```json
{
  "note_id": "...",
  "version_id": "...",
  "title": "...",
  "folder_id": "...",
  "created_at": "..."
}
```

**Errors:**

| Code | Meaning |
|---|---|
| `forbidden` | Connection lacks `generate_in_allowed_folders` permission, or folder does not accept generated notes |
| `bad_request` | Missing required fields |
| `not_found` | folder_id not found / not in allowed scopes |

**Generated note promotion is human-only.** External connections cannot promote generated notes via the API in V1. Promotion is performed by the workspace owner through the human app. See `docs/machine_write_v1.md` for promotion semantics.

---

## Authorization model

Authorization is evaluated per-request in two layers:

1. **Token auth** — bearer token parsed, hashed, and compared against `connection_tokens`. Token must be `status = active` and not expired.
2. **Scope check** — the resolved connection's `connection_box_scopes` records determine which box IDs are accessible. All resource requests are filtered through this set.

Ownership chain:
- Notes and folders are owned by a box.
- Boxes are owned by a workspace.
- A connection belongs to a workspace.

So the full check for a note is:
1. Token auth → `connection` → `workspaceId`
2. `note.box_id ∈ connection.allowedBoxIds`
3. `box.workspace_id === connection.workspaceId` (defense in depth)

---

## Export ZIP format

ZIP packages use DEFLATE compression. The manifest is always at `manifest.json`. These are the contents of the zip downloaded from the signed URL.

### Note package

```
manifest.json
notes/<note-slug>.md
```

### Folder / box package

```
manifest.json
notes/<path>/<note-slug>.md
```

### Context bundle package

```
manifest.json
README.md        (suggested reading order)
notes/<slug>.md  (target note)
notes/<slug>.md  (linked notes, guide, ancestor summary)
```

See `docs/import_export_v1.md` for manifest schema details and import vocabulary validation rules.

---

## Example requests

```bash
# List scoped boxes
curl -H "Authorization: Bearer csk_v1_..." \
  https://your-domain.com/api/v1/boxes

# Fetch a note
curl -H "Authorization: Bearer csk_v1_..." \
  https://your-domain.com/api/v1/notes/<note_id>

# Search within a box
curl -X POST -H "Authorization: Bearer csk_v1_..." \
  -H "Content-Type: application/json" \
  -d '{"box_id": "<box_id>", "query": "machine learning", "limit": 10}' \
  https://your-domain.com/api/v1/search_notes

# Assemble a context bundle
curl -X POST -H "Authorization: Bearer csk_v1_..." \
  -H "Content-Type: application/json" \
  -d '{"note_id": "<note_id>"}' \
  https://your-domain.com/api/v1/context_bundles

# Export a note — get signed URL, then download the zip
EXPORT=$(curl -s -X POST -H "Authorization: Bearer csk_v1_..." \
  -H "Content-Type: application/json" \
  -d '{"note_id": "<note_id>"}' \
  https://your-domain.com/api/v1/export_note)
SIGNED_URL=$(echo "$EXPORT" | jq -r '.data.signed_url')
FILENAME=$(echo "$EXPORT" | jq -r '.data.filename')
curl -o "$FILENAME" "$SIGNED_URL"
```
