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
    { "id": "...", "sourceNoteId": "...", "targetNoteId": "...", "relationshipType": "..." }
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
  "created_at": "...", "updated_at": "..."
}
```

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
      "relationship_type": "references" | "extends" | "related" | "contradicts" | "supersedes",
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

All export endpoints return raw binary ZIP files, not JSON. The response `Content-Type` is `application/zip`.

#### `POST /api/v1/export_note`

Exports a single note as a `.zip` package.

**Request body:** `{ "note_id": "..." }`

**Response:** `application/zip` binary, `Content-Disposition: attachment; filename="<name>.zip"`

---

#### `POST /api/v1/export_folder`

Exports a folder and all its notes as a `.zip` package.

**Request body:** `{ "folder_id": "..." }`

**Response:** `application/zip` binary

---

#### `POST /api/v1/export_box`

Exports an entire box (all folders + notes) as a `.zip` package.

**Request body:** `{ "box_id": "..." }`

**Response:** `application/zip` binary

---

#### `POST /api/v1/export_context_bundle`

Assembles a context bundle for a note and exports it as a `.zip` package.
The ZIP includes a manifest, individual note files, and a `README.md` with the suggested reading order.

**Request body:**

```json
{
  "note_id": "...",
  "include_guide": true,
  "include_ancestor_summary": true,
  "linked_limit": 10
}
```

**Response:** `application/zip` binary

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

ZIP packages use DEFLATE compression. The manifest is always at `manifest.json`.

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

See `docs/import_export_v1.md` for manifest schema details.

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

# Export a note to disk
curl -X POST -H "Authorization: Bearer csk_v1_..." \
  -H "Content-Type: application/json" \
  -d '{"note_id": "<note_id>"}' \
  -o note_export.zip \
  https://your-domain.com/api/v1/export_note
```
