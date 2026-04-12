# Expanded object model import/export fix — V1

This document describes the April 2026 corrective pass on Context Store's
portability layer. Before this pass, the export service only populated
Notes in folder and box zips, and Skill/Agent packaged exports were
single-file wrappers that did not reflect the real multi-file package
structure. Import could already process the expanded manifest for
top-level objects but was never fed one. This pass ships real end-to-end
support for Notes, Files, Folders, Skills, Agents, Boxes, and Bundles.

---

## What was broken

1. Folder export included notes and folders only — Files, Skills, Agents
   inside the subtree were silently dropped.
2. Box export had the same gap — it only packaged notes and folders.
3. Skill packaged export was a single-file zip containing just the
   canonical source, despite Skills supporting child files and nested
   folders via `parent_skill_id` FK.
4. Agent packaged export was a single-file zip containing just the
   canonical source, despite Agents supporting children via
   `parent_agent_id` and Skill references via `object_links`.
5. The `object_links` array in the manifest was defined but always
   empty.
6. Import service could not apply folders during workspace-level imports
   (required for reusable Skill/Agent packages owning workspace-level
   folders).
7. Import service could not apply files when no box target was selected,
   blocking reusable object children from round-tripping.
8. `object_links` were never imported — semantic relationships were lost
   on every import cycle.

---

## Export behavior now

### Note (single)

Unchanged in shape — markdown file plus minimal manifest. Still schema
`1.0`.

### File (single)

A zip with `manifest.json` plus the file's real source content under
`files/<slug>.<ext>`. Extension and `canonical_format` preserved.
Schema `1.1`.

### Folder

A zip containing:
- `manifest.json`
- Notes as `notes/<path>.md`
- Files as `files/<slug>.<ext>`
- Skills as `skills/<slug>.<ext>`
- Agents as `agents/<slug>.<ext>`

Manifest populates `folders`, `notes`, `links`, `object_files`, `skills`,
`agents`, and `object_links`. Schema `1.1` whenever the folder contains
any non-note object; falls back to `1.0` for pure-note subtrees.

### Box

Same as folder, but covers the entire box (all active folders, notes,
files, skills, and agents). Semantic links include both `note_links` and
`object_links` between heterogeneous objects.

### Skill — canonical source only

Returns a raw file, not a zip. The single canonical editable source file
is downloaded with its real extension (e.g., `my-skill.md`,
`parser.ts`).

### Skill — packaged

A zip containing:
- `manifest.json`
- `source.<ext>` — the canonical editable source file at the zip root
- `children/<folder-tree>/<file>.<ext>` — every child file, preserving
  nested folder structure owned by the Skill via `parent_skill_id`

Manifest populates:
- `skills: [<the skill>]`
- `folders: [...child folders]` (with relative paths under `children/`)
- `object_files: [...child files]`
- `object_links: [...parent_of edges]` connecting the skill to its
  children

### Agent — canonical source only

Same as Skill — raw single-file download of the canonical editable
source.

### Agent — packaged

A zip containing:
- `manifest.json`
- `source.<ext>` — canonical source at the root
- `children/<folder-tree>/<file>.<ext>` — every child file (via
  `parent_agent_id`)

Manifest populates:
- `agents: [<the agent>]`
- `folders: [...child folders owned by the agent]`
- `object_files: [...child files]`
- `skills: [...referenced skills metadata only, no source content]`
- `object_links: [...edges connecting agent to children and to
  referenced skills]`

The referenced Skills entries are metadata only: their canonical source
and own children are NOT included in the agent zip. Skills are
independent packageable objects — the agent export just references
them so the importer can re-resolve the link.

### Bundle

Unchanged in scope (still note-centric). A bundle is a notes-oriented
primitive by design; expanding it to heterogeneous objects is a separate
product decision.

---

## Packaged vs canonical source only

| | Canonical source only | Full package |
| --- | --- | --- |
| Applies to | Skill, Agent | Skill, Agent, File, Folder, Box |
| Result | Raw single file | Zip + manifest |
| Use case | Paste into another editor, copy to git | Round-trip import with full fidelity |
| Includes manifest? | No | Yes |
| Includes children? | No | Yes (Skills and Agents) |
| Includes links? | No | Yes (filtered to package) |
| Preserves ids? | No | Yes (stable ids are canonical identity) |

The UI in `src/components/product/export_menu.tsx` exposes both modes
for Skills and Agents with clear labels: "Canonical source only" vs
"Full package (zip + manifest)".

---

## Manifest schema

The v1.1 manifest remains the single canonical portability contract:

```
{
  "schema_version": "1.1",
  "export_type": "note" | "file" | "folder" | "box" | "skill" | "agent" | "bundle",
  "exported_at": "<ISO timestamp>",
  "workspace": { "id": "...", "name": "..." },
  "box": null | { "id": "...", "name": "...", "slug": "..." },
  "root": null | "<folder_id>",
  "folders": [...],
  "notes": [...],
  "links": [...],        // note-to-note links
  "object_files": [...], // files (non-markdown artifacts)
  "skills": [...],
  "agents": [...],
  "object_links": [...], // cross-type semantic links
  "bundle": null | { ... },
  "files": ["<relative paths of every content file in zip>"],
  "counts": { folders, notes, links, files, skills, agents }
}
```

Key schema rules preserved this pass:

1. Stable ids carry through `id` fields on every object entry.
2. Paths are derived convenience only (never identity).
3. `canonical_format` and `file_extension` are preserved for Files.
4. `is_reusable` is preserved for Skills and Agents — importers MUST
   NOT silently convert.
5. `object_links` rows include the exact `relationship_type` string.
6. Child folders owned by a Skill/Agent in packaged exports use relative
   paths (under `children/`) that do not collide with box-scoped paths.

See `src/server/domain/types/import_export.ts` for the full TypeScript
shape.

---

## Import behavior now

The import service (`src/server/services/import_service.ts`) has been
extended in three ways:

1. **Folders are importable when boxId is null** — the old guard
   rejected workspace-level folder imports. Now reusable Skill/Agent
   packaged imports can restore the skill/agent-owned folder tree at
   the workspace level.
2. **Files are importable when boxId is null** — same fix. Workspace
   level files land with `box_id = null` and `workspace_id` set.
3. **object_links are imported** — after all folders, notes, files,
   skills, and agents have been applied (with id remapping tracked in
   per-type id maps), a new step walks `manifest.object_links`,
   remaps both endpoints, and calls `createObjectLink`. For
   `parent_of` edges targeting folders or files, the importer also
   sets the direct FK (`parent_skill_id` or `parent_agent_id`) so the
   imported package matches how the live app creates children.

Collision modes continue to apply to all object types (Files, Skills,
Agents already had full support). `create_copy`, `replace_by_id`,
`merge_metadata_only`, and `remap_ids_and_import` all work across the
expanded model. `object_link` duplicate-key errors are treated as
benign `skipped` actions rather than hard failures.

---

## Collision handling across the expanded model

| Mode | Folder | Note | File | Skill | Agent | object_link |
| --- | --- | --- | --- | --- | --- | --- |
| create_copy | slug-disambiguated | path-disambiguated | path-disambiguated | slug-disambiguated | slug-disambiguated | created; dup = skipped |
| replace_by_id | metadata update | new version | new version | new version | new version | created; dup = skipped |
| merge_metadata_only | metadata only | metadata only, never body | metadata only, never source | metadata only | metadata only | created; dup = skipped |
| remap_ids_and_import | new id, references remapped | new id, references remapped | new id | new id | new id | remapped endpoints |

Every collision outcome is recorded as an `ImportAction` and surfaced in
the post-import summary.

---

## UI entry points

| Surface | Exports | Via |
| --- | --- | --- |
| Note page | Note (markdown + manifest), Context Bundle | `NoteExportMenu` |
| File page | File (with extension and format) | `FileExportMenu` (existing) |
| Folder page | Folder (heterogeneous) | `FolderExportButton` |
| Skill page | Canonical source only OR full package | `SkillExportMenu` |
| Agent page | Canonical source only OR full package | `AgentExportMenu` |
| Box page | Full heterogeneous box, or any folder inside it | `BoxExportMenu` |

Labels and descriptions explicitly describe what is in each package.
"Export" buttons never imply markdown-only behavior.

---

## Migrations

No new migrations were needed for this pass. The prior migration
(`supabase/migrations/20260412000001_skill_agent_child_containment.sql`)
added the `parent_skill_id` and `parent_agent_id` FK columns on `files`
and `folders`, plus nullable `box_id` on `folders`. That work is
leveraged here: the export service traverses those FKs to find package
children, and the import service sets them when restoring `parent_of`
links.

---

## Files changed

| File | Change |
| --- | --- |
| `src/server/services/export_service.ts` | Skill / Agent packaged exports now include child files and nested folders + object_links. Folder and box exports now include files/skills/agents and their object_links. New helpers: `collectSkillPackageContents`, `collectAgentPackageContents`, `collectObjectLinksForExport`, `filePathForChildFile`, `toManifestChildFile`. |
| `src/server/services/import_service.ts` | `applyFolder` and `applyFile` accept nullable boxId. `applyManifest` removes the workspace-level folder guard and adds Step 4b: `applyObjectLink` processing for every object_link in the manifest, setting `parent_skill_id` / `parent_agent_id` FKs for `parent_of` edges. |
| `src/components/product/export_menu.tsx` | Skill and Agent export menu descriptions rewritten to reflect canonical-only vs full-package behavior. Box and folder descriptions updated to name every object type included. |
| `src/components/product/folder_export_button.tsx` | Tooltip reflects heterogeneous contents. |
| `docs/expanded_object_import_export_fix_v1.md` | This document. |

---

## Remaining limitations

1. **Bundles remain note-centric.** Extending them to heterogeneous
   objects is a separate product decision — the bundle assembly service
   is deeply tied to note-specific metadata (read_hint,
   retrieval_priority, ancestor summaries).
2. **Reusable object references are not deep-copied.** When an Agent
   references a Skill, the Agent package includes the Skill's metadata
   only. Recipients must re-attach or import the Skill separately.
   This is intentional — reusable Skills are workspace-scoped assets
   that should not proliferate implicitly through Agent imports.
3. **Import size bound is still 25MB per zip.** Large Skill/Agent
   packages with many large child files may require splitting.
4. **Cross-workspace attachment replay is not supported.** The
   `box_object_attachments` table is workspace-scoped and not part of
   the manifest; attaching a reusable object after import remains a
   manual step in the UI.
