# Object Model Expansion V1

This document describes Context Store's expansion from a notes-only object model to a four-type object taxonomy. It covers the new types, the shared structural registry, canonical source semantics, reusable object attachment, cross-type relationships, versioning, trust rules, and groundwork for retrieval and portability.

---

## 1. Overview

V1 Context Store has one primary content type: the Note. Everything in the hierarchy — boxes, folders, guide notes, context bundles — is ultimately about notes or groups of notes.

The object model expansion adds three new first-class content types:

| Type | What it represents |
|---|---|
| **File** | Any non-markdown artifact — images, PDFs, code files, data files |
| **Skill** | A reusable functional building block — a prompt template, a procedure, a callable unit |
| **Agent** | A structured orchestrator — defined inputs, outputs, and behavior with explicit wiring |

The motivations are:

1. **Real content is not notes-only.** Code files, diagrams, reference data, and configuration are meaningful artifacts in a workspace. Treating them as second-class attachments loses semantic value.
2. **Reusability.** Skills and agents are the natural objects of reuse across boxes. A skill written once should be attachable to any box that needs it, without duplication.
3. **Structural consistency.** Adding new types to a shared registry allows tree navigation, graph traversal, search, and context bundle assembly to operate uniformly across all types with minimal per-type branching.

Existing notes and all V1 behavior are unchanged. This is a strictly additive expansion.

---

## 2. Object taxonomy

### Note

- Markdown-only. Body is always `markdown_content` text.
- Human-authored document. Represents prose, structured notes, guides, and bundles.
- Versioned via `note_versions` (unchanged from V1).
- No `canonical_format` field — notes are always markdown by definition.
- Lives in a box, optionally in a folder. Can be root-level or nested.
- Fields include `kind`, `read_hint`, and `retrieval_priority` — these are note-specific and not present on other object types.

### File

- All non-markdown artifacts: JSON, YAML, Python, TypeScript, SQL, HTML, CSS, images, binaries, and any other saved artifact.
- Versioned via `object_versions` (shared versioning table, described in §7).
- Has a `canonical_format` field: the authoritative editable format for this object. Fixed at creation or import time.
- Other representations (e.g. a rendered preview, a thumbnail) are computed on demand and never stored as separate objects.
- Lives in a box, optionally in a folder.
- No `kind`, `read_hint`, or `retrieval_priority` — those are note-specific.

### Skill

- A reusable functional building block. May be a prompt template, a retrieval procedure, a parameterized instruction set, or any callable unit that performs a defined function.
- Versioned via `object_versions`.
- Has a `canonical_format` field.
- Can be **workspace-level** (`is_reusable = true`) or **box-local** (`is_reusable = false`).
- Workspace-level skills are attached to boxes via `box_object_attachments`. Box-local skills belong to a single box and cannot be attached to others.
- Context Store stores and versions skills. It does not execute them.

### Agent

- A structured orchestrator. Defines explicit inputs, outputs, and behavior — the "wiring" that connects skills, notes, and external tools into a coherent automated workflow.
- Versioned via `object_versions`.
- Has a `canonical_format` field plus structured core fields: `agent_type`, `model_hint`, `system_prompt`.
- `model_hint` is a reference preference, not an execution configuration. `system_prompt` is stored for context retrieval and export.
- Can be **workspace-level** (`is_reusable = true`) or **box-local** (`is_reusable = false`).
- Workspace-level agents are attached to boxes via `box_object_attachments`.
- Context Store stores and versions agents. It does not execute them.

### Summary table

| Type | Stored in | Version table | `canonical_format` | `is_reusable` |
|---|---|---|---|---|
| Note | `notes` | `note_versions` | — (always markdown) | — |
| File | `files` | `object_versions` | yes | — (always box-local) |
| Skill | `skills` | `object_versions` | yes | yes |
| Agent | `agents` | `object_versions` | yes | yes |

---

## 3. Shared structural layer — `workspace_objects`

### What it is

`workspace_objects` is a flat registry of all named content objects in a workspace, regardless of type. Every note, file, skill, and agent has a corresponding row in `workspace_objects`. Folders are also registered (object_type = `'folder'`) to enable uniform tree queries.

Key columns:

```
id            uuid    -- shared with the type-specific table (same uuid)
workspace_id  uuid    -- workspace ownership
box_id        uuid?   -- box placement (null for workspace-level reusable objects)
folder_id     uuid?   -- folder placement (null = box root)
object_type   text    -- 'note' | 'file' | 'skill' | 'agent' | 'folder'
display_name  text    -- denormalized from core table, kept in sync
slug          text    -- URL-safe identifier
status        text    -- mirrors core table status
is_reusable   bool    -- true = workspace-level shared skill/agent
sort_order    int     -- ordering within parent container
created_at    timestamptz
updated_at    timestamptz
```

The `id` in `workspace_objects` is the canonical identifier for the object. Type-specific tables use the same uuid as their PK, so a join requires no translation.

### What it does

`workspace_objects` enables uniform operations across all types:

- **Tree navigation** — folder trees enumerate any mix of notes, files, skills, and agents. The tree service queries `workspace_objects` filtered by `box_id` and `folder_id`, then fetches type-specific metadata in a second pass when needed.
- **Cross-object indexing** — search, graph, and overview queries operate on `workspace_objects` as a single entry point rather than issuing per-type UNION queries.
- **Permission targeting** — all objects are reachable via `workspace_id`; a single workspace ownership check covers all types.
- **Audit targeting** — `object_type` + `id` provides a polymorphic pointer for audit events covering any object type.
- **Graph traversal** — `object_links` references `workspace_objects.id` on both sides. Graph queries traverse `object_links` without needing to know the type of each endpoint ahead of time.

### Keeping it in sync

`workspace_objects` is a **derived registry**, not the source of truth for any object's content. The source of truth for a note is the `notes` table; for a file, the `files` table; and so on.

`object_registry_service.ts` is responsible for maintaining consistency:

1. **On create** — insert a corresponding `workspace_objects` row immediately after inserting the core row.
2. **On rename** — call `syncObjectDisplayName()` to propagate the new name.
3. **On lifecycle change** — call `syncObjectStatus()` to mirror the status change.
4. **On soft delete** — sync status to `'trashed'` in the registry.

Direction always flows from type-specific table to registry. The registry row is never the trigger for mutations in the type-specific tables.

---

## 4. Canonical editable source model

### One format per object

Every file, skill, and agent has exactly one `canonical_format`. This is the format in which the object is authored, stored, and versioned. It is set at creation or import time.

Supported formats by type:

| Object type | Example `canonical_format` values |
|---|---|
| File | `plain_text`, `json`, `yaml`, `toml`, `python`, `typescript`, `javascript`, `shell`, `sql`, `html`, `css`, `xml`, `binary` |
| Skill | `markdown`, `json`, `yaml`, `typescript`, `python` |
| Agent | `json`, `yaml`, `markdown` |

Notes have no `canonical_format` field. Notes are always markdown.

### Fixed at creation

`canonical_format` is set once and is not editable by application code after the object exists. The object's version history and stored content are all in this format. Converting an object to a different format requires creating a new object; there is no format migration path in V1.

### Other representations are read-only exports

The canonical format is the only stored form. If a consumer wants a different representation — a CSV previewed as an HTML table, a YAML skill filled in as a prompt, a Python file rendered with syntax highlighting — that representation is computed on demand and not stored as a separate object. There is no `rendered_content` column or sibling object for alternate views.

This keeps the storage model simple: one object, one canonical source, one version chain.

---

## 5. Reusable reference model

### `is_reusable` flag

Skills and agents have an `is_reusable` boolean column on their respective type-specific tables, mirrored in `workspace_objects.is_reusable`.

- `is_reusable = false` — box-local. The object belongs to one box. It appears in that box's tree and is not attachable to other boxes.
- `is_reusable = true` — workspace-level. The object can be attached to any box. It may have a `box_id` (its home box, where it was created) or `box_id = null` (pure workspace-level with no home box).

Files and notes do not have `is_reusable`. Files are always box-local. Notes are always box-local.

### `box_object_attachments`

The join table between boxes and reusable workspace-level skills or agents.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `box_id` | uuid FK | → `boxes` |
| `object_type` | text | `'skill'` \| `'agent'` |
| `object_id` | uuid FK | → `workspace_objects` |
| `folder_id` | uuid | nullable — placement within the target box |
| `sort_order` | integer | ordering in the target box's tree |
| `attached_by` | uuid | user id |
| `created_at` | timestamptz | |

**Constraint:** `UNIQUE (box_id, object_type, object_id)` — a skill or agent may be attached to a box at most once.

Only objects with `is_reusable = true` may appear in `box_object_attachments`. The service layer enforces this before inserting.

### Local vs attached

When a service resolves "all objects available in box B," it combines two disjoint sets:

1. **Box-local objects** — `workspace_objects WHERE box_id = B`.
2. **Attached objects** — objects referenced via `box_object_attachments WHERE box_id = B`.

Attached objects appear by reference. No copy is made. When the source object is updated, all boxes that have it attached automatically reflect the current version. An attachment can be detached without affecting the source or other boxes.

### Trust rules for reusable objects

External connections (MCP clients, API integrations) with `propose_writes` or `full_write` permission may not write directly to workspace-level reusable skills or agents. Any write attempt from an external connection to a reusable object is downgraded to a `write_proposal`, regardless of the connection's declared permission mode.

Human users (authenticated via the app, not via connection tokens) may write directly to all objects they own, including reusable workspace-level objects.

The rationale: a reusable skill attached to a dozen boxes is high blast-radius. External agents must not be able to mutate it without human review.

---

## 6. Shared semantic relationships — `object_links`

### Table

`object_links` is the cross-type relationship table. It handles any combination of content object types (note, file, skill, agent). Note-to-note relationships continue to use `note_links` for backward compatibility (see below).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | → `workspaces` |
| `source_object_id` | uuid FK | → `workspace_objects` |
| `target_object_id` | uuid FK | → `workspace_objects` |
| `relationship_type` | text | one of 10 canonical values |
| `relationship_note` | text | nullable annotation |
| `created_at` | timestamptz | |

### Relationship vocabulary

The same 10-value vocabulary as `note_links`:

`related`, `depends_on`, `parent_of`, `child_of`, `reference_for`, `extends`, `example_of`, `sibling_of`, `supersedes`, `derived_from`

No new relationship types are added in this expansion. The 10-value set covers the semantics for all type combinations.

See [relationship_contract_correction_v1.md](relationship_contract_correction_v1.md) for the full vocabulary rationale.

### Supported type combinations

All 16 combinations of the four object types are valid in `object_links`. The DB does not restrict type combinations. A few examples:

| Source | Target | Example use |
|---|---|---|
| Note | File | Note `reference_for` a PDF data source |
| Note | Skill | Note `depends_on` a skill it describes |
| Skill | Agent | Skill `child_of` the agent that wires it |
| Agent | Note | Agent `depends_on` a guide note |
| File | Note | File `derived_from` a note that generated it |
| Skill | Skill | Skill `extends` a base skill |

### Constraints

- `CHECK (source_object_id <> target_object_id)` — no self-links.
- `CHECK (relationship_type IN (...))` — enforced 10-value vocabulary.
- `UNIQUE (source_object_id, target_object_id, relationship_type)` — no duplicate links per type.
- Same-workspace enforcement: `workspace_id` must match the workspace of both endpoint objects. Enforced by `object_link_service.ts` (not expressible as a DB CHECK without a subquery).

### Backward compatibility: `note_links`

`note_links` is not deprecated. Existing note-to-note relationships remain in `note_links`. `link_service.ts` continues to manage `note_links` for note-to-note relationships without modification.

The routing convention: when both endpoints are notes, use `note_links`. When at least one endpoint is a non-note type, use `object_links`. The `object_link_service.ts` is a separate service that manages `object_links` exclusively.

---

## 7. Versioning and lifecycle

### Notes: unchanged

Notes continue to use `note_versions`. The `note_versions` table, the `create_note_with_initial_version` RPC, the `update_note_and_create_version` RPC, and `version_history_service.ts` are all unchanged.

### Files, skills, agents: `object_versions`

`object_versions` is the shared immutable versioning table for files, skills, and agents.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `object_id` | uuid FK | → `workspace_objects` |
| `parent_version_id` | uuid | nullable FK → `object_versions` (linked list) |
| `version_number` | integer | monotonically increasing per object, starting at 1 |
| `actor_type` | text | `'user'` \| `'connection'` \| `'system'` |
| `actor_id` | text | uuid or `'system'` |
| `change_origin` | text | `'human_edit'` \| `'import'` \| `'generated'` \| `'proposal_approved'` \| `'rollback'` |
| `canonical_format` | text | snapshot of `canonical_format` at this version |
| `content_ref` | text | storage path or inline content reference |
| `content_bytes` | integer | byte size of this version's content |
| `diff_summary` | jsonb | lightweight change description |
| `created_at` | timestamptz | |

No `updated_at` — immutable by design, same as `note_versions`. No UPDATE or DELETE RLS policies exist for `object_versions`.

Object creation and editing use Postgres RPC functions for atomicity, mirroring the note pattern:

- `create_object_with_initial_version(...)` — inserts core row + version_1 + updates `current_version_id` in one transaction.
- `update_object_and_create_version(...)` — inserts a new version + updates core content fields and `current_version_id` in one transaction.

The current version for a file, skill, or agent is tracked via `current_version_id` on the respective type-specific table, mirroring `notes.current_version_id`.

### Lifecycle states

All four object types share the same lifecycle vocabulary:

| Status | Meaning |
|---|---|
| `draft` | In progress; not yet active or visible by default |
| `active` | Visible and accessible |
| `archived` | Hidden from default views; accessible via opt-in filter |
| `trashed` | Excluded from all queries; uniqueness indexes exclude trashed rows |

Notes gain the `draft` status as part of this expansion — it was not present in V1 notes. `draft` is particularly meaningful for skills and agents under construction before they are ready for use.

`workspace_objects.status` mirrors the status of the underlying object and is updated by `object_registry_service.ts` whenever the type-specific table's status changes.

---

## 8. Trust rules for shared objects

### Summary

| Object | External connection (`propose_writes`) | External connection (`full_write`) | Human user |
|---|---|---|---|
| Note (box-local) | Proposal only | Direct write | Direct write |
| File (box-local) | Proposal only | Direct write | Direct write |
| Skill (box-local) | Proposal only | Direct write | Direct write |
| Agent (box-local) | Proposal only | Direct write | Direct write |
| Skill (workspace-level, `is_reusable = true`) | Proposal only | **Proposal only** | Direct write |
| Agent (workspace-level, `is_reusable = true`) | Proposal only | **Proposal only** | Direct write |

The critical distinction: `full_write` permission does not grant external connections direct writes to reusable workspace-level objects. That permission is reserved for human users. The service layer enforces this by checking `is_reusable` before routing a write.

### Write proposals extended to new types

`write_proposals.proposal_type` gains new values covering file, skill, and agent operations:

`'create_file'`, `'update_file'`, `'create_skill'`, `'update_skill'`, `'create_agent'`, `'update_agent'`

The existing `'create_note'` and `'update_note'` values are unchanged. Proposal review, approval, conflict detection, and audit flows work identically across all proposal types.

---

## 9. Retrieval participation groundwork

### What is implemented now

The structural groundwork for cross-type retrieval is in place:

- `workspace_objects` is populated for all four object types (plus folders).
- `object_links` provides traversable heterogeneous graph edges between any two objects.
- All four object types have `status`, `display_name`, `slug`, `box_id`, and `object_type` in `workspace_objects`, enabling uniform filtering without per-type UNION queries.

### Cross-type search (future prompt)

`workspace_objects` is the structural precondition for a `search_objects` RPC. The implementation — adding a `search_vector` tsvector column to `workspace_objects` (or a parallel FTS table), defining weighted fields per object type, and extending `search_service.ts` — is planned for a future prompt. The registry itself is the groundwork. Current search via `search_notes` is unchanged.

### Heterogeneous graph (future prompt)

`overview_service.ts` currently traverses `note_links` for the box overview. A future expansion will query `object_links` in addition, returning a graph whose nodes can be notes, files, skills, or agents. The `object_links` table is the groundwork. The `overview_service.ts` and `box_overview_panel.tsx` are not modified in this expansion.

### Context bundles centered on non-note objects (future prompt)

`context_bundle_service.ts` currently assembles bundles centered on a note. The structural preconditions for bundles centered on a file, skill, or agent — traversable `object_links` edges and `workspace_objects` registry entries — are now in place. Extending `assembleContextBundle` to accept a non-note entry point is a future prompt.

### Notes and NoteLinks: unchanged

`search_notes`, `link_service.ts`, `note_links`, and all retrieval behavior documented in [retrieval_layer_v1.md](retrieval_layer_v1.md) are unchanged. No existing retrieval code path is modified by this expansion.

---

## 10. Import/export groundwork

### What is implemented now

- `ExportManifest` includes extensible `files`, `skills`, and `agents` arrays. These arrays are empty in all current exports (notes-only content), but the schema accepts and validates them.
- `ManifestFile`, `ManifestSkill`, and `ManifestAgent` type stubs are defined in `src/server/domain/types/import_export.ts`.
- Import parsing recognizes the `object_type` field on incoming manifest entries (`'note'`, `'file'`, `'skill'`, `'agent'`). Unrecognized types produce a warning and are skipped without failing the import.
- The `canonical_format` field is read from incoming manifests and stored on creation. If absent, it is detected from file extension. If both are present and conflict, the declared `canonical_format` wins with a `canonical_format_override` warning.
- Schema version: `"1.0"` for notes-only manifests (backward compatible). `"1.1"` when any non-note objects are present.

### Full file/skill/agent export (future prompt)

`export_service.ts` currently exports notes and their markdown content. Exporting files, skills, and agents requires packaging the canonical content (which may be binary for files), populating `ManifestFile`/`ManifestSkill`/`ManifestAgent` entries, and updating `ExportArtifact` counts. Full export assembly for new types is a future prompt.

### Packaged export for complex objects (future prompt)

Agents may reference skills; skills may include child files. A packaged agent export bundles the agent plus all referenced skills and their files into a single zip. The manifest's `object_links` entries describe the internal references. Full packaged export assembly is a future prompt.

### Full import flows for new types (future prompt)

`import_service.ts` routing for file, skill, and agent manifest entries — collision mode application, version creation via `create_object_with_initial_version`, `ImportSummaryReport` counts — is planned. The schema detection and `object_type` routing stubs are in place; full service and UI coverage is a future prompt.

---

## 11. Migration notes

### Backfill of `workspace_objects` for existing notes and folders

All existing notes and folders must have corresponding rows in `workspace_objects`. The migration includes a backfill query that inserts them. The backfill uses `ON CONFLICT DO NOTHING`, making it safe to re-run.

Notes are registered with `object_type = 'note'`. Folders are registered with `object_type = 'folder'`. No data on the `notes` or `folders` tables is changed.

### Zero data loss guarantee

The expansion is strictly additive:

- No existing tables are modified (columns are added only; none are removed or renamed).
- No existing rows are deleted.
- `note_links` is preserved and not migrated to `object_links`.
- All existing RLS policies, indexes, triggers, and RPC functions remain in place.
- `note_versions` and all note versioning logic are untouched.

Any code path that operated correctly on notes in V1 continues to operate correctly after the migration. All new functionality is in new tables, new services, and new repositories.

### Migration files

| File | Contents |
|---|---|
| `supabase/migrations/20260411000001_object_model_expansion.sql` | `workspace_objects`, `files`, `skills`, `agents`, `object_versions`, `object_links`, `box_object_attachments` tables; indexes; constraints; atomic RPC functions |
| `supabase/migrations/20260411000002_object_model_rls.sql` | RLS policies for all 7 new tables |
| `supabase/migrations/20260411000003_workspace_objects_backfill.sql` | Backfill of existing notes and folders into `workspace_objects` |
