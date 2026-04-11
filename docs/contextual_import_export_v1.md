# Contextual Import and Export — Expanded Object System

This document specifies how import and export work for Files, Skills, and Agents in Context Store. Notes, Folders, and Boxes were already covered in `docs/import_export_v1.md`. This document extends portability to the full object model.

---

## Scope

This document covers:
- Manifest schema v1.1 (extends v1.0)
- Export for Files, Skills, and Agents (canonical_source and packaged modes)
- Import for Files, Skills, and Agents (via manifest or zip packages)
- Workspace-level import (no box required for reusable skill/agent packages)
- Export UI surface: `SkillExportMenu`, `AgentExportMenu`, `FileExportMenu`
- Import UI surface: `SkillImportTrigger`, `AgentImportTrigger` (on library pages)
- Collision modes and reusability preservation

Explicitly excluded: execution, trust redesign, API/MCP redesign, collaboration.

---

## Manifest schema v1.1

Schema v1.0 is unchanged. v1.1 adds four optional fields to `ExportManifest`:

```typescript
object_files?: ManifestFile[];     // Files exported
skills?: ManifestSkill[];          // Skills exported
agents?: ManifestAgent[];          // Agents exported
object_links?: ManifestObjectLink[]; // Cross-type semantic links
```

The `counts` struct also gains `skills` and `agents` fields.

`export_type` now includes: `"note" | "folder" | "box" | "bundle" | "file" | "skill" | "agent"`

### ManifestFile

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Stable ID from database |
| `folder_id` | uuid \| null | Folder placement within box |
| `name` | string | |
| `slug` | string | |
| `path` | string | path_cache |
| `status` | string | active, archived, draft |
| `description` | string \| null | |
| `summary` | string \| null | |
| `tags` | string[] | |
| `origin_type` | string | |
| `canonical_format` | string | e.g. typescript, python, json |
| `file_extension` | string \| null | e.g. .ts, .py |
| `source_language` | string \| null | |
| `content_sha256` | string | SHA-256 of source_content |
| `file_path` | string | Relative path in zip (e.g. `files/my-script.ts`) |

### ManifestSkill

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `folder_id` | uuid \| null | |
| `name`, `slug`, `path`, `status` | string | |
| `description`, `summary` | string \| null | |
| `tags` | string[] | |
| `origin_type` | string | |
| `canonical_format` | string | |
| `is_reusable` | boolean | **Must be preserved on import** |
| `content_sha256` | string | |
| `file_path` | string | e.g. `skills/my-skill.md` |

### ManifestAgent

Same as ManifestSkill plus:
| `agent_type` | string \| null | e.g. reasoning, coding, orchestration |

### ManifestObjectLink

Cross-type semantic links between any exported objects.

| Field | Type |
|---|---|
| `id` | uuid |
| `source_type` | string |
| `source_id` | uuid |
| `target_type` | string |
| `target_id` | uuid |
| `relationship_type` | string |
| `relationship_note` | string \| null |

---

## Export modes for Skills and Agents

Two modes, selectable in `SkillExportMenu` / `AgentExportMenu`:

### `canonical_source`

Downloads the raw source content as a single file (e.g. `my-skill.md`, `my-agent.ts`).
- No manifest, no zip
- Suitable for copying source into another editor or version control
- Delivered via `deliverRawContent` with the appropriate MIME type

### `packaged`

Downloads a zip containing:
- `manifest.json` (schema_version: "1.1", export_type: "skill"|"agent")
- The source file at `skills/<slug><ext>` or `agents/<slug><ext>`

The packaged format preserves: id, name, slug, tags, description, summary, is_reusable, canonical_format, agent_type.
Round-trip import restores all of these.

---

## Export: File

Files always use the `packaged` mode (zip with manifest). The `FileExportMenu` is a single-click button with no mode selection.

The zip contains:
- `manifest.json` (schema_version: "1.1", export_type: "file")
- Source file at `files/<slug><ext>`

---

## Source format → file extension map

| Format | Extension | MIME |
|---|---|---|
| markdown | .md | text/markdown |
| json | .json | application/json |
| yaml | .yaml | text/yaml |
| typescript | .ts | text/x-typescript |
| python | .py | text/x-python |
| javascript | .js | text/javascript |
| shell | .sh | text/x-shellscript |
| sql | .sql | application/sql |
| html | .html | text/html |
| css | .css | text/css |
| toml | .toml | text/x-toml |
| xml | .xml | application/xml |
| plain_text | .txt | text/plain |

---

## Import: Skills and Agents

### Entry points

- **Skill library page** (`/app/skills`): "Import" button opens `SkillImportDialog`
- **Agent library page** (`/app/agents`): "Import" button opens `AgentImportDialog`
- **Box/folder import** (`ImportDialog`): zip packages with v1.1 manifests automatically import skills/agents alongside notes/files

### What gets imported

From a v1.1 manifest zip:
- `object_files` entries → created as Files in the target box
- `skills` entries → created as Skills (respecting `is_reusable`)
- `agents` entries → created as Agents (respecting `is_reusable`)
- Folders, notes, links → same as before

### Reusability preservation

**The `is_reusable` flag is always preserved from the manifest.** If a skill was reusable at export time, it remains reusable on import. The import service does not silently convert reusable objects to box-local.

Reusable skills/agents (`is_reusable: true`) are created with `box_id = null` in the workspace library.
Box-local skills/agents (`is_reusable: false`) require a target box.

If a box-local skill/agent is found in a workspace-level import (no box available), it is skipped with a warning.

### Workspace-level import

`importWorkspaceLevelPackageAction` imports a v1.1 zip without requiring a box. This is the action used by `SkillImportDialog` and `AgentImportDialog`.

After import, revalidates `/app/skills` and `/app/agents`.

---

## Collision modes

All four existing collision modes apply to files, skills, and agents:

| Mode | Behavior for Files/Skills/Agents |
|---|---|
| `create_copy` | Always create new objects; no collision check on ids |
| `replace_by_id` | If id exists in same box/workspace, update source + metadata via `update_object_and_create_version` |
| `merge_metadata_only` | If id exists, update only description/tags/summary; never replace source content |
| `remap_ids_and_import` | If id is already taken, create with a new id; record original id in import actions |

---

## Zip file recognition

The import service now recognizes additional extensions inside zip packages:

- `.md` → note (or skill/agent source in markdown format, per manifest)
- `.ts`, `.tsx`, `.js`, `.jsx` → TypeScript/JavaScript source
- `.py` → Python source
- `.sh`, `.bash` → Shell script
- `.sql` → SQL query
- `.json` → JSON
- `.yaml`, `.yml` → YAML
- `.toml` → TOML
- `.xml` → XML
- `.html` → HTML
- `.css` → CSS
- `.txt` → plain text

Unrecognized extensions produce a warning and are skipped (not an error).

---

## Import summary report changes

`ImportSummaryReport` now includes files, skills, and agents in all count fields:

```typescript
created_counts: { folders, notes, links, files, skills, agents }
replaced_counts: { folders, notes, files, skills, agents }
duplicated_counts: { folders, notes, files, skills, agents }
remapped_counts: { folders, notes, files, skills, agents }
skipped_counts: { folders, notes, links, files, skills, agents }
```

The existing import dialogs display action log entries for all object types.

---

## UI components

| Component | File | Purpose |
|---|---|---|
| `SkillExportMenu` | `export_menu.tsx` | Export a skill (canonical_source or packaged) |
| `AgentExportMenu` | `export_menu.tsx` | Export an agent (canonical_source or packaged) |
| `FileExportMenu` | `export_menu.tsx` | Export a file (packaged zip) |
| `SkillImportDialog` | `skill_import_dialog.tsx` | Import a skill zip into workspace library |
| `SkillImportTrigger` | `skill_import_dialog.tsx` | Button that opens SkillImportDialog |
| `AgentImportDialog` | `agent_import_dialog.tsx` | Import an agent zip into workspace library |
| `AgentImportTrigger` | `agent_import_dialog.tsx` | Button that opens AgentImportDialog |

---

## Surface placement

| Surface | Export | Import |
|---|---|---|
| `skills/[skill_id]` page header | `SkillExportMenu` | — |
| `agents/[agent_id]` top bar | `AgentExportMenu` | — |
| `skills/page.tsx` header | — | `SkillImportTrigger` |
| `agents/page.tsx` header | — | `AgentImportTrigger` |

---

## Service layer

### `exportFile(supabase, workspaceId, fileId)` → `ExportPackage`

Fetches file, verifies workspace ownership, builds v1.1 manifest with `object_files: [mf]`, returns `ExportPackage`.

### `exportSkill(supabase, workspaceId, skillId, mode)` → `ExportPackage | RawExportContent`

- `canonical_source` → returns `RawExportContent` with source content and appropriate MIME type
- `packaged` → returns `ExportPackage` zip with manifest

### `exportAgent(supabase, workspaceId, agentId, mode)` → `ExportPackage | RawExportContent`

Same as `exportSkill`.

### `importPackage(..., target: { boxId: string | null, ... })`

`boxId` is now optional (nullable). When null, only reusable skill/agent imports proceed (box-local objects are skipped with a warning).

### `applyFile`, `applySkill`, `applyAgent`

Internal functions in `import_service.ts`. Each handles all four collision modes, workspace_objects registration, and action logging.

---

## Artifact delivery

### Zipped packages

`deliverExportPackage(adminClient, workspaceId, pkg)` — unchanged. Used for `packaged` mode and file exports.

### Raw content

`deliverRawContent(adminClient, workspaceId, raw)` — new function. Uploads raw UTF-8 content with the correct MIME type. Used for `canonical_source` skill/agent exports. Delivers a signed URL to the raw file (not zipped).

---

## Known limitations and follow-ons

1. **No box-level file/skill/agent export inclusion.** Box exports (exportBox) still only include notes and folders. Including skills/agents in box exports is a follow-on.
2. **No cross-type object_links export yet.** The `ManifestObjectLink` type is defined and ready, but the export service does not yet populate it. A follow-on will add `object_links` to box/folder exports.
3. **No file_id page export trigger.** The `FileExportMenu` component exists but is not yet placed on the files detail page — it can be added when the file detail page is implemented.
4. **No schema detection in import dialog.** When a user drops a file, there is no automatic detection panel explaining what will be imported. A type-picker enhancement is a follow-on.
5. **No attachment count in export.** The export summary does not show how many skill/agent packages are already attached to boxes. A count badge is a follow-on.
