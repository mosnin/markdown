# Object Model Expansion v1

This document describes the extension of Context Store from a notes-only system
to a four-type content object model: **notes**, **files**, **skills**, and **agents**.

It covers the object taxonomy, shared structural layer, canonical source model,
reusable reference model, versioning, trust, retrieval groundwork, and migration safety.

---

## 1. Object taxonomy

Context Store stores, organizes, relates, retrieves, exports, and safely updates
four first-class content object types. It does **not** execute them.

### Note
- Markdown-only. Always. Notes are the canonical human document type.
- Version history in `note_versions` (unchanged from v1).
- Fields: `title`, `markdown_content`, `kind`, `read_hint`, `retrieval_priority`.
- Not covered by `canonical_format` — markdown is the implicit format.
- The `box.guide_note_id` pointer remains the only canonical guide assignment.

### File
- All non-markdown saved artifacts: JSON, YAML, TOML, Python, TypeScript, Shell,
  SQL, HTML, CSS, XML, plain text, binary blobs.
- Has an explicit `canonical_format` field (see §4).
- Version history in `object_versions` (shared with skills and agents).
- No `kind`, `read_hint`, or `retrieval_priority` — those are note-specific.

### Skill
- A reusable structured building block with one canonical editable source format.
- Can be box-local (`is_reusable = false`) or workspace-level reusable (`is_reusable = true`).
- Workspace-level reusable skills can be attached into multiple boxes by reference.
- Version history in `object_versions`.
- External writes to reusable skills must go through proposals (see §8).

### Agent
- A reusable structured orchestrator with a canonical editable source plus
  structured core fields: `agent_type`, `model_hint`, `system_prompt`.
- Same reusable / box-local duality as skills.
- `model_hint` is a reference preference, not an execution config.
- `system_prompt` is the canonical system prompt text, stored for context.
- Context Store does **not** execute agents.
- Version history in `object_versions`.

### Naming rules

| Type  | Stored in | Version table     | Canonical format |
|-------|-----------|-------------------|------------------|
| note  | `notes`   | `note_versions`   | always markdown  |
| file  | `files`   | `object_versions` | `canonical_format` field |
| skill | `skills`  | `object_versions` | `canonical_format` field |
| agent | `agents`  | `object_versions` | `canonical_format` field |

---

## 2. Shared structural layer

### `workspace_objects` table

Every content object (note, file, skill, agent, folder) is registered in
`workspace_objects` at creation time. This table is the canonical source for:

- **Tree participation** — box and folder placement, sort order
- **Cross-object indexing** — search, graph, and overview can query one table
- **Permission targeting** — all objects reachable via workspace ownership
- **Audit targeting** — `object_type` + `object_id` polymorphic pointer

Key columns:

```
object_type   text    -- 'note' | 'file' | 'skill' | 'agent' | 'folder'
object_id     uuid    -- FK to notes.id / files.id / skills.id / agents.id / folders.id
workspace_id  uuid    -- workspace ownership
box_id        uuid?   -- box placement (null for workspace-level reusable objects)
folder_id     uuid?   -- folder placement (null = box root)
display_name  text    -- denormalized from core table, kept in sync
sort_order    int     -- ordering within parent container
status        text    -- mirrors core table status
is_reusable   bool    -- true = workspace-level shared skill/agent
```

### Keeping the registry in sync

The service layer is responsible for keeping `workspace_objects` in sync
with the core tables. Rules:

1. On create: call `object_registry_service.registerObject()` immediately after
   inserting the core row.
2. On rename: call `syncObjectDisplayName()`.
3. On lifecycle change: call `syncObjectStatus()`.
4. On delete (soft): sync status to `trashed`.

The registry does **not** duplicate content — only structural/placement metadata.

### Backfill

Migration `20260411000003_workspace_objects_backfill.sql` inserts all existing
non-trashed notes and folders into `workspace_objects`. No data is changed on
the core tables. Conflict guard `ON CONFLICT DO NOTHING` makes the migration
safe to re-run.

---

## 3. Canonical editable source model

Every file, skill, and agent has exactly **one** canonical editable source format.

- Chosen at creation or import time via the `canonical_format` field.
- **Fixed** unless explicitly converted (not implemented in this prompt).
- All other representations (e.g. rendered HTML, exported YAML from a JSON source)
  are **generated read-only exports** — not coequal editable sources.

Notes are excluded from this model. Notes are always markdown. There is no
`canonical_format` on the `notes` table.

### Supported formats

Files support all formats: `plain_text`, `json`, `yaml`, `toml`, `xml`,
`python`, `typescript`, `javascript`, `shell`, `sql`, `html`, `css`,
`markdown` (file stored as .md but not a note), `binary`.

Skills and agents support a subset: `markdown`, `json`, `yaml`, `typescript`, `python`.

---

## 4. Reusable reference model

### Local vs reusable objects

| Placement | `is_reusable` | `box_id` | Owned by |
|-----------|--------------|----------|----------|
| Box-local skill/agent | false | set | that box |
| Workspace-level reusable | true | null or set | workspace |

### Attaching reusable objects into boxes

A workspace-level reusable skill or agent (`is_reusable = true`) can be attached
into multiple boxes via `box_object_attachments`:

```
box_object_attachments
  box_id        -- the target box
  object_type   -- 'skill' or 'agent'
  object_id     -- points to skills.id or agents.id
  folder_id?    -- optional placement in a folder within the box
  sort_order    -- tree position
```

Attached objects:
- **Appear by reference** — no copy is made.
- **Auto-reflect updates** — the source object is updated; attachments show the current state.
- **Can be detached** without affecting the source or other boxes.
- UNIQUE constraint `(box_id, object_type, object_id)` prevents duplicate attachments.

### Trust for reusable objects

External writes (via MCP, API token connections) to workspace-level reusable skills
and agents **must go through write proposals**. Direct writes by the workspace owner
are allowed. This preserves the principle that shared reusable objects cannot be
silently mutated by external agents.

---

## 5. Shared semantic relationships

### `object_links` table

Heterogeneous relationships between any combination of content object types.
Generalizes `note_links` to cross-type relationships.

Supported endpoint types: `note`, `file`, `skill`, `agent`, `folder`.

Supported combinations (all):
- note ↔ note (via object_links; note_links retained for backward compat)
- note ↔ file, note ↔ skill, note ↔ agent
- file ↔ file, file ↔ skill, file ↔ agent
- skill ↔ skill, skill ↔ agent
- agent ↔ agent
- any ↔ folder

### Relationship vocabulary

The same 10-value vocabulary as `note_links`:
`related`, `depends_on`, `parent_of`, `child_of`, `reference_for`,
`extends`, `example_of`, `sibling_of`, `supersedes`, `derived_from`.

### Note-to-note backward compatibility

Existing note-to-note relationships remain in `note_links`. The `note_links`
table is not deprecated. When both endpoints are notes, use `note_links`.
When at least one endpoint is a non-note type, use `object_links`.

---

## 6. Versioning and lifecycle

### Versioning

| Object | Version table | RPC function |
|--------|--------------|--------------|
| Note | `note_versions` | `update_note_and_create_version` |
| File | `object_versions` | `update_object_and_create_version` |
| Skill | `object_versions` | `update_object_and_create_version` |
| Agent | `object_versions` | `update_object_and_create_version` |

`object_versions` is immutable — no UPDATE or DELETE policies.
`version_number` is 1-indexed, monotonically increasing per object.
`parent_version_id` forms a linked list for rollback.

### Lifecycle states

All object types share the same lifecycle vocabulary:
`draft` → `active` → `archived` → `trashed`

Trashed objects are excluded from uniqueness indexes and search results.
Soft delete only — hard delete never happens in application code.

---

## 7. Search, graph, and bundle groundwork

The schema foundation is ready. Full implementations follow in future prompts.

### Search groundwork
`workspace_objects` provides a single indexed entry point for cross-type search.
Future: extend `search_service` to query files, skills, and agents via FTS on
their `source_content`, `name`, `tags`, and `description` fields.

### Graph groundwork
`object_links` provides the heterogeneous edge set.
Future: extend `overview_service` to include file/skill/agent nodes and
`object_links` edges alongside the existing `note_links` graph.

### Context bundle groundwork
The `context_bundle_service` currently centers on a note.
Future: any object type (note, file, skill, agent) can be the bundle center.
Folders are excluded from bundles (structural, not content objects).

---

## 8. Import and export groundwork

The schema and type foundation is ready. Full UI flows follow in future prompts.

### Import
- Explicit `object_type` field in manifest entries: `note | file | skill | agent | folder`.
- Schema detection with override: `canonical_format` is detected from content or
  provided explicitly at import time.
- Collision modes (create_copy, replace_by_id, merge_metadata_only, remap_ids_and_import)
  apply to all object types.

### Export
- **Note**: unchanged — markdown file export.
- **File**: canonical source content in its native format.
- **Skill**: canonical source + optional child file manifest.
- **Agent**: canonical source + system_prompt + optional child files + skill refs.
- Packaged export (zip) for complex objects with children.

### Manifest extensibility
`ExportManifest` will gain `files`, `skills`, and `agents` arrays alongside
the existing `folders` and `notes` arrays. Schema versioning via `manifest_version`
field handles backward compatibility.

---

## 9. Migration safety

1. **Zero data loss** — no existing notes, folders, boxes, or relationships are modified.
2. **Additive schema** — all new tables are independent of existing tables.
3. **Safe backfill** — `workspace_objects` backfill uses `ON CONFLICT DO NOTHING`.
4. **No circular FK issues** — deferred FKs for `current_version_id` added after
   `object_versions` exists (same pattern as `notes.current_version_id`).
5. **RLS complete** — all new tables have RLS enabled with workspace ownership checks.

---

## 10. What is implemented now vs later

### Implemented in this prompt
- Schema: all 7 new tables with indexes, constraints, RLS
- Backfill: existing notes/folders registered in workspace_objects
- Domain constants: OBJECT_TYPE, SOURCE_FORMAT, AGENT_TYPE, OBJECT_STATUS, etc.
- Domain types: WorkspaceObject, File, Skill, Agent, ObjectVersion, ObjectLink, BoxObjectAttachment
- Domain schemas (zod): createFileSchema, createSkillSchema, createAgentSchema + update variants
- Repositories: all 7 new repos fully implemented
- Services: file_service, skill_service, agent_service, object_link_service, object_registry_service
- RPC functions: create_object_with_initial_version, update_object_and_create_version

### Planned for future prompts
- UI: file editor, skill editor, agent editor
- UI: reusable skill/agent browser and attachment flow
- Extended search: cross-type FTS via workspace_objects
- Extended graph: heterogeneous object_links in overview_service
- Extended context bundles: non-note bundle centers
- Extended export: packaged export for skills/agents with children
- Extended import: full manifest v2 with files/skills/agents
- Write proposals for reusable objects (extend write_proposal_service)
