# Import / Export V1

This document describes Context Store's portability layer — how notes, folders, boxes, and context bundles can be exported and re-imported.

---

## What portability means

Context Store is not a local-only product. An authenticated owner can:

- Export a note, folder, box, or context bundle as a structured zip package
- Import a `.md` file or zip package into any owned box
- Choose explicit collision behavior before import
- Receive a legible summary report after import

This is a first-class product capability, not a developer utility.

---

## Manifest schema

Every exported zip contains a `manifest.json` at the root. The manifest is the authoritative description of the package.

```
manifest.json {
  schema_version    "1.0"
  export_type       "note" | "folder" | "box" | "bundle"
  exported_at       ISO timestamp
  workspace         { id, name }
  box               { id, name, slug } | null   (null for note-only exports)
  root              folder_id | null             (set for folder exports)
  folders[]         ManifestFolder entries
  notes[]           ManifestNote entries
  links[]           ManifestLink entries
  bundle            ManifestBundle | null        (only for bundle exports)
  files[]           array of relative paths to markdown files
  counts            { folders, notes, links, files }
}
```

### ManifestFolder

| Field | Description |
|---|---|
| `id` | Stable DB id |
| `parent_id` | Parent folder id or null |
| `name` | Display name |
| `slug` | URL-safe slug |
| `path` | Derived path (e.g. `research/papers`) |
| `status` | `active`, `archived` |
| `description` | Optional description |

### ManifestNote

| Field | Description |
|---|---|
| `id` | Stable DB id |
| `folder_id` | Parent folder id or null |
| `title` | Display title |
| `slug` | URL-safe slug |
| `path` | Derived path within box |
| `status` | `active`, `archived`, etc. |
| `summary` | Optional summary |
| `tags` | Array of tag strings |
| `origin_type` | `user_created`, `imported`, `generated_by_tool`, `duplicated`, `restored` |
| `read_hint` | Optional retrieval hint — one of `read_first`, `core_reference`, `supporting_context`, `related`, `archive_only`, `generated`, or null |
| `is_generated` | Boolean |
| `current_version_id` | Points to the version snapshot |
| `is_guide_note` | True when this note is the box's guide |
| `content_sha256` | SHA-256 of markdown_content |
| `file_path` | Relative path to the `.md` file in the zip |

### ManifestLink

| Field | Description |
|---|---|
| `id` | Stable link id |
| `source_note_id` | Source note id |
| `target_note_id` | Target note id |
| `relationship_type` | Canonical value from the 10-value set — never normalized on export; validated on import |
| `relationship_note` | Optional annotation describing the specific link — preserved exactly on export; imported as stored |

### ManifestBundle (context bundle exports only)

| Field | Description |
|---|---|
| `entry_note_id` | The note the bundle is centered on |
| `guide_note_id` | Guide note id if included |
| `ancestor_summary_note_id` | Ancestor summary note id if included |
| `included_note_ids` | All note ids in the bundle |
| `linked_limit` | The limit applied during assembly |
| `truncated` | Whether any bound was hit |
| `truncation_reasons` | Machine-readable reason strings |

---

## Export package structure

### Note export

```
note-slug.zip
├── manifest.json
└── notes/
    └── note-slug.md
```

### Folder export

```
folder-name-folder.zip
├── manifest.json
└── notes/
    ├── folder-path_note-one.md
    └── folder-path_note-two.md
```

Folder hierarchy is captured in the manifest. Notes are flat in the zip (path separators replaced with underscores).

### Box export

```
box-name-box.zip
├── manifest.json
└── notes/
    ├── note-one.md
    └── subfolder_note-two.md
```

### Context bundle export

```
bundle-entry-note.zip
├── manifest.json
├── README.md
└── notes/
    ├── entry-note.md
    ├── guide-note.md       (if included)
    ├── ancestor-note.md    (if included)
    └── linked-note.md      (one per linked note, in bundle order)
```

The README includes a suggested upload order:
1. Guide note (if present)
2. Entry note
3. Ancestor summary note (if present)
4. Linked notes in bundle order

---

## Export delivery model

All export operations (human UI and canonical API) produce a signed, expiring download URL via Supabase Storage.

1. The export service assembles an `ExportPackage` in memory (manifest + markdown files map).
2. The artifact delivery service (`artifact_delivery_service.ts`) zips the package and uploads it to the private `exports` Supabase Storage bucket.
3. A signed download URL is generated and returned. The URL expires in **1 hour**.
4. The caller downloads the zip by GETting the signed URL before expiration.

### Export artifact response shape

Every export endpoint returns an `ExportArtifact`:

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

The `exports` storage bucket is private — no public URLs are ever issued. Signed URLs expire after 3,600 seconds. Files accumulate in the bucket; V1 has no automatic purge.

### Human app export flow

1. User clicks an export button in the UI.
2. The server action assembles and uploads the package.
3. The action returns `{ ok: true, data: ExportArtifact }`.
4. The client calls `triggerSignedDownload(data.signed_url, data.filename)` — an anchor click on the signed URL.
5. The browser downloads the zip directly from Supabase Storage.

---

## Export rules

- Trashed content: **never included**
- Archived content: **excluded by default** (no opt-in UI in V1; service layer supports `includeArchived` flag)
- Relationship types: **canonical values only** — exported faithfully from the 10-value canonical set
- Links: only included when **both endpoints** are inside the exported set
- Guide note flag: derived from `boxes.guide_note_id` at export time; stored in `ManifestNote.is_guide_note`

---

## How context bundle export differs from context bundle viewing

| | Bundle viewing (UI tab) | Bundle export |
|---|---|---|
| **Purpose** | Show bounded context in the app | Create a portable package for external use |
| **ContextBundle type** | Used directly for display | Used only for note selection and order |
| **Markdown bodies** | Not shown in bundle metadata | Fetched separately and included in zip |
| **README** | Not produced | Produced with suggested upload order |
| **Mutation of ContextBundle shape** | Not mutated | Not mutated — fetched alongside |

The export service calls `assembleContextBundle` to determine which notes are included and in what order. It then fetches full note bodies separately via `getNotesByIds`. The `ContextBundle` output type is never extended to carry file content.

---

## Import

### Supported inputs

| Input | Behavior |
|---|---|
| `.md` file | One note created, title from first `# H1` or filename |
| `.zip` without `manifest.json` | Each `.md` file becomes a note |
| `.zip` with `manifest.json` | Manifest drives folder/note/link creation |

### Import bounds

| Limit | Value |
|---|---|
| Package size | 25 MB |
| Combined folder + note count | 1,000 |
| Supported file types in zip | `.md`, `manifest.json`, `README.md` |
| Malformed zip | Hard failure |
| Invalid manifest schema | Hard failure |
| Unsupported collision mode | Hard failure |

Non-recognized file types inside a zip generate a warning and are ignored. Missing link targets are warnings, not hard failures.

### Import vocabulary validation

On import, the service validates and sanitizes values from incoming manifests:

- **`relationship_type`** is validated against the canonical 10-value set (`related`, `depends_on`, `parent_of`, `child_of`, `reference_for`, `extends`, `example_of`, `sibling_of`, `supersedes`, `derived_from`). Non-canonical values produce a `non_canonical_relationship_type` warning and the link is skipped — notes are still created.
- **`read_hint`** is sanitized against the canonical 6-value set (`read_first`, `core_reference`, `supporting_context`, `related`, `archive_only`, `generated`). Non-canonical values are nulled before the DB insert, with a `non_canonical_read_hint` warning — the note is still created, just without the hint.
- **`origin_type`** on import is always forced to `"imported"` regardless of the manifest value. The manifest's `origin_type` is not re-applied.

---

## Collision modes

Collision mode is chosen explicitly before import. There is no default that silently overwrites.

### `create_copy`

- Objects with colliding ids or paths receive new ids and `-copy` suffix-disambiguated slugs.
- Existing content is never overwritten.
- If the manifest declares a guide note (`is_guide_note: true`) and that note is successfully imported, the box guide note is updated.

### `replace_by_id`

- Objects whose ids match existing objects **of the same type** are updated in place.
- Notes are updated via the `update_note_and_create_version` RPC — new version created atomically.
- Folders update metadata and placement only.
- Type mismatches (e.g. incoming id matches a folder but manifest says it's a note) produce a skip warning.
- If the manifest declares a guide note and that note is successfully imported, the box guide note is updated.

### `merge_metadata_only`

- Never replaces markdown body.
- Merges `summary`, `tags`, and `read_hint` for matching notes.
- Creates a new version only when metadata actually changed.
- If the manifest declares a guide note and that note is successfully imported, the box guide note is updated.

### `remap_ids_and_import`

- All colliding ids receive new generated ids.
- Internal parent folder references and link references are rewritten to use new ids.
- Original incoming ids are recorded in the import summary report for traceability.
- If the manifest declares a guide note and that note is successfully imported (possibly with a remapped id), the box guide note is updated.

### Guide note restoration

When a manifest produced by a full box export includes a note with `is_guide_note: true`, the import service assigns that note as the box's guide note after all notes and links are created. This ensures guide note designation survives round-trip through export and re-import.

Conditions for restoration:
- The manifest must have been produced by a box export (includes `is_guide_note` fields).
- The declared guide note must have been successfully created or updated during the import.
- If the note was skipped (due to collision, wrong box, or failure), a warning is added and the box guide note is not changed.
- `guide_note.assigned` audit event is fired on successful restoration.

---

## Import summary report

After every import, a structured summary is returned and displayed in the UI.

```
ImportSummaryReport {
  collision_mode
  created_counts   { folders, notes, links }
  replaced_counts  { notes, folders }
  duplicated_counts { notes, folders }
  remapped_counts  { notes, folders }
  skipped_counts   { notes, folders, links }
  actions[]
  warnings[]
}
```

Each `ImportAction` records:

| Field | Description |
|---|---|
| `object_type` | `folder`, `note`, or `link` |
| `incoming_id` | Id from the package |
| `final_id` | Id written to the database |
| `incoming_path` | Path from the package |
| `final_path` | Path as written |
| `action` | `created`, `replaced`, `duplicated`, `remapped`, or `skipped` |
| `reason` | Human-readable explanation (especially for skipped) |

---

## Ownership checks

All ownership verification happens inside the service layer before any read or write.

**Export paths:**
1. Resolve the note / folder / box
2. Verify `box.workspace_id === workspaceId` (from `getRequestContext()`)
3. Linked notes and folder descendants are fetched from the same owned box — implicitly owned

**Import paths:**
1. Verify target `box.workspace_id === workspaceId`
2. Verify target folder (if provided) has `box_id === target.boxId`
3. All notes and folders are created inside the verified owned box
4. Incoming manifest ids are never trusted as proof of ownership

**Two-hop pattern** (because `notes` and `folders` have no `workspace_id`):
```
note / folder → box → workspace_id
```

---

## Versioning behavior

| Operation | Versioning |
|---|---|
| Import creates note | Creates initial version via `create_note_with_initial_version` RPC |
| `replace_by_id` update | Creates new version via `update_note_and_create_version` RPC |
| `merge_metadata_only` with changes | Creates new version only when metadata actually changed |
| `merge_metadata_only` no changes | No version created |

---

## Audit events

| Event | Trigger |
|---|---|
| `note.exported` | Single note export |
| `folder.exported` | Folder export |
| `box.exported` | Box export |
| `bundle.exported` | Context bundle export |
| `import.completed` | Successful import (any type) |

All events are append-only and include useful metadata (counts, collision mode, truncation status).

---

## Service and type locations

| File | Purpose |
|---|---|
| `src/server/domain/types/import_export.ts` | `ExportManifest`, `ExportArtifact`, `ManifestSummary`, `ImportSummaryReport`, `CollisionMode`, etc. |
| `src/server/services/export_service.ts` | `exportNote`, `exportFolder`, `exportBox`, `exportBundle`, `packageToZip` |
| `src/server/services/artifact_delivery_service.ts` | `deliverExportPackage` — zips and uploads to private Storage, returns signed URL |
| `src/server/services/import_service.ts` | `importPackage` — parse + validate + apply |
| `src/app/app/import_export/actions.ts` | `exportNoteAction`, `exportBoxAction`, `exportBundleAction`, `importPackageAction` — all return `ExportArtifact` |
| `src/components/product/export_menu.tsx` | `NoteExportMenu`, `BoxExportMenu` client components — download via signed URL |
| `src/components/product/import_dialog.tsx` | `ImportDialog`, `ImportTriggerButton` client components |
| `supabase/migrations/20260409000010_export_artifacts_bucket.sql` | Creates private `exports` Storage bucket |
