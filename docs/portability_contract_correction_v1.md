# Portability Contract Correction V1

This document records the corrections applied to Context Store's import and export behavior. These changes bring the product closer to the original handoff contract.

---

## What changed and why

Prior to this correction:
- Export server actions returned base64-encoded zip blobs to the client.
- Canonical API export routes returned raw binary zip bytes in the HTTP response body.
- No canonical `import_package` API endpoint existed.
- Import validation did not enforce canonical `relationship_type` or `read_hint` values from the manifest.

After this correction:
- All export operations produce signed, expiring download URLs via Supabase Storage.
- The canonical API export endpoints return signed URL responses in the standard envelope.
- The human app export UI downloads via the signed URL.
- `POST /api/v1/import_package` exists as a canonical API endpoint (human session only).
- Import validates and sanitizes `relationship_type` and `read_hint` from manifest.

---

## 1. Signed export delivery model

### How it works

1. The export service assembles an `ExportPackage` in memory (manifest + markdown files map).
2. The artifact delivery service (`artifact_delivery_service.ts`) zips the package and uploads it to the private `exports` Supabase Storage bucket.
3. A signed download URL is generated and returned. The URL expires in **1 hour**.
4. The caller (human UI or API client) downloads the zip by GETting the signed URL before expiration.

### Storage bucket

| Property | Value |
|---|---|
| Bucket name | `exports` |
| Visibility | **Private** — no public URLs issued |
| File size limit | 25 MB |
| MIME types | `application/zip`, `application/octet-stream` |
| Path convention | `{workspaceId}/{unix-ms}-{filename}` |

The workspace ID prefix provides natural namespacing — a leaked path is scoped to one workspace and useless without a fresh signed URL.

### Expiry

Signed URLs expire after **3,600 seconds (1 hour)**. Expired URLs return a storage error. The `expires_at` field in every response is an ISO timestamp that clients should check before using.

### V1 cleanup strategy

Artifacts accumulate in the bucket. Signed URLs expire (making the artifact inaccessible), but the files themselves persist. In V1 there is no automatic purge. A future retention job can delete objects older than a configurable threshold (e.g., 7 days) using the Supabase Storage management API by listing `{workspaceId}/` paths and filtering by `created_at`.

### Security properties

- No public bucket or public URLs.
- Ownership verification happens before artifact generation, not after.
- Signed URLs are never logged or included in audit event metadata.
- The admin (service-role) client is used only for the upload and signing operations — all data reads use the authenticated user client.

---

## 2. Export response shape

All export endpoints now return the `ExportArtifact` shape:

```json
{
  "signed_url": "https://<project>.supabase.co/storage/v1/object/sign/exports/...",
  "expires_at": "2026-04-09T14:00:00.000Z",
  "filename": "my-box-box.zip",
  "size_bytes": 65536,
  "manifest_summary": {
    "export_type": "box",
    "note_count": 42,
    "folder_count": 8,
    "link_count": 17
  }
}
```

Canonical API routes wrap this in the standard `{ data, meta }` envelope.

Human app server actions return this directly as `ActionResult<ExportArtifact>`.

---

## 3. Human export flow after correction

1. User clicks "Export note / folder / box / bundle" in the UI.
2. The server action assembles and uploads the package.
3. The action returns `{ ok: true, data: ExportArtifact }`.
4. The client calls `triggerSignedDownload(data.signed_url, data.filename)` — an anchor click on the signed URL.
5. The browser downloads the zip from Supabase Storage.

The human app no longer handles raw zip bytes or base64. The download is initiated by navigating to the signed URL, which Supabase Storage delivers with `Content-Disposition: attachment; filename=...`.

---

## 4. Canonical import_package contract

### Endpoint

`POST /api/v1/import_package`

### Authentication

**Human session only.** External bearer token connections are not supported for import in V1.

**Rationale:** Import creates content from an external untrusted package, potentially at scale (up to 1,000 objects). Allowing connections to import would let any connection with box-scope access flood a workspace with arbitrary content without human review. The existing permission modes (`read_only`, `propose_writes`, `generate_in_allowed_folders`) do not naturally extend to bulk package import. This decision preserves the existing trust model without adding a new connection permission mode.

A connection sending a bearer token to this endpoint will receive a `401 Unauthorized` response.

### Request

```
Content-Type: multipart/form-data

Fields:
  file             File      Required. .md or .zip, max 25 MB.
  box_id           string    Required. Target box UUID.
  collision_mode   string    Required. One of: create_copy, replace_by_id,
                             merge_metadata_only, remap_ids_and_import.
  target_folder_id string    Optional. Target folder UUID (must belong to box).
```

### Supported package formats

| Input | Behavior |
|---|---|
| `.md` file | One note created; title from first H1 or filename |
| `.zip` without `manifest.json` | Each `.md` file becomes a note |
| `.zip` with `manifest.json` | Manifest drives folder/note/link creation |

### Response

Standard envelope wrapping an `ImportSummaryReport`:

```json
{
  "data": {
    "collision_mode": "create_copy",
    "created_counts": { "folders": 2, "notes": 5, "links": 3 },
    "replaced_counts": { "notes": 0, "folders": 0 },
    "duplicated_counts": { "notes": 0, "folders": 0 },
    "remapped_counts": { "notes": 0, "folders": 0 },
    "skipped_counts": { "notes": 0, "folders": 0, "links": 0 },
    "actions": [...],
    "warnings": [...]
  },
  "meta": { "request_id": "...", "api_version": "v1" }
}
```

### Hard failures (400)

- Malformed zip
- Invalid manifest schema
- Unsupported collision mode
- Package size > 25 MB
- Combined folder + note count > 1,000

---

## 5. Manifest fidelity after contract corrections

The manifest schema remains at `"schema_version": "1.0"`. The shape has not changed — only the values are now faithful to the corrected vocabularies from prior prompts:

| Field | Before | After |
|---|---|---|
| `notes[].origin_type` | May have been `"human"` or `"generated"` | Now `"user_created"`, `"imported"`, `"generated_by_tool"`, etc. |
| `notes[].read_hint` | Unconstrained string | Now canonical 6-value or null |
| `links[].relationship_type` | May have included `"references"` or `"contradicts"` | Now canonical 10-value only |
| `links[].relationship_note` | Already present since Prompt 14 | Unchanged |
| `notes[].is_guide_note` | Already present | Unchanged |
| `notes[].current_version_id` | Already present | Unchanged |

No manifest keys were renamed or removed. Consumers that parse `manifest.json` will see faithfully corrected values without any schema migration.

---

## 6. Round-trip fidelity

### Improvements

1. `relationship_note` is now faithfully included in manifest links and preserved on re-import (was null in earlier builds).
2. `origin_type` is now canonical in exported manifests (`user_created`, `imported`, `generated_by_tool`).
3. `read_hint` values in manifests are now from the canonical 6-value set.

### Import validation

On import, the service now:
- **Validates `relationship_type`** against the canonical 10-value set. Non-canonical values produce a `non_canonical_relationship_type` warning and the link is skipped (notes are still created).
- **Sanitizes `read_hint`** against the canonical 6-value set. Non-canonical values are nulled before the DB insert, with a `non_canonical_read_hint` warning (note is still created, just without the hint).

### Known V1 limits

| Limit | Value |
|---|---|
| Package size | 25 MB |
| Combined folder + note count | 1,000 |
| `origin_type` on import | Always `"imported"` — manifest origin_type is not re-applied |
| `change_origin` on import | Always `"import"` — correct for all import write paths |
| Guide note assignment | Never automatically transferred from manifest |
| Artifact retention | No automatic cleanup in V1 |

---

## 7. Shared packaging logic

Both the human app and canonical API use:

- `exportNote / exportFolder / exportBox / exportBundle` (same assembly service)
- `deliverExportPackage` (same artifact delivery service)

There is one packaging path, one manifest shape, and one import application path. No duplicated base64 or binary streaming branches exist after this correction.

---

## Files added or modified

| File | Change |
|---|---|
| `supabase/migrations/20260409000010_export_artifacts_bucket.sql` | Creates private `exports` bucket |
| `src/server/services/artifact_delivery_service.ts` | New — packages and delivers export artifacts via signed URLs |
| `src/server/domain/types/import_export.ts` | Added `ExportArtifact` and `ManifestSummary` types |
| `src/server/services/import_service.ts` | Added `relationship_type` validation and `read_hint` sanitization |
| `src/app/app/import_export/actions.ts` | Export actions return `ExportArtifact` via artifact delivery |
| `src/app/api/v1/export_note/route.ts` | Returns signed URL JSON via `apiOk()` |
| `src/app/api/v1/export_folder/route.ts` | Returns signed URL JSON via `apiOk()` |
| `src/app/api/v1/export_box/route.ts` | Returns signed URL JSON via `apiOk()` |
| `src/app/api/v1/export_context_bundle/route.ts` | Returns signed URL JSON via `apiOk()` |
| `src/app/api/v1/import_package/route.ts` | New canonical import endpoint (human session only) |
| `src/components/product/export_menu.tsx` | Downloads via signed URL instead of base64 |
