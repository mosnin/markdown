# Agents as a First-Class Object Type

This document specifies the Agents object, its workspace surface, creation flows, editing model, export views, child structure, skill references, lifecycle, and how it differs from Notes, Files, and Skills.

---

## What an Agent is

An **Agent** is a structured reusable orchestrator stored in Context Store. It has:
- A canonical editable source format (e.g. `markdown`, `json`, `yaml`, `typescript`, `python`)
- A structured core: `agent_type`, `model_hint`, `system_prompt`
- Optional child associations (files and notes linked via semantic relationships)
- Optional skill and file references
- Semantic relationships to other objects in the workspace
- Immutable version history
- A lifecycle (draft / active / archived / trashed)

Context Store stores, organizes, versions, relates, and exports agents. It does **not** execute them.

### Agents vs Skills vs Files vs Notes

| Dimension | Note | File | Skill | Agent |
|---|---|---|---|---|
| Format | Markdown only | Typed code/data | markdown/json/yaml/ts/py | markdown/json/yaml/ts/py |
| Purpose | Human prose/docs | Code artifacts | Reusable building blocks | Structured orchestrators |
| Structured core | No | No | No | Yes (agent_type, model_hint, system_prompt) |
| Workspace surface | Two-mode editor | Code textarea | Simple page | Six-tab workspace |
| Right pane | Info/Links/Bundle/History | Info/Links/History | — | Info/Links/History |
| Exports tab | No | No | No | Yes (generated read-only) |
| Children tab | No | No | No | Yes (associated objects) |
| Skills tab | No | No | No | Yes (skill/file references) |
| Bundle tab | Yes | No | No | No |

**Agents must not become Notes, Files, or Skills.** They are heavier, more structured, and represent orchestration logic rather than prose or code artifacts.

---

## Domain model

### Database table: `agents`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | |
| `box_id` | uuid FK nullable | null for workspace-level reusable agents |
| `folder_id` | uuid FK nullable | |
| `name` | text | |
| `slug` | text | unique per box |
| `path_cache` | text | denormalized path |
| `source_content` | text | canonical editable source |
| `content_bytes` | int | auto-maintained |
| `canonical_format` | SkillAgentFormat | chosen at creation, immutable |
| `agent_type` | AgentType nullable | reasoning, coding, research, planning, retrieval, synthesis, orchestration, custom |
| `model_hint` | text nullable | preferred model identifier (not execution config) |
| `system_prompt` | text nullable | canonical system prompt text |
| `description` | text nullable | |
| `summary` | text nullable | AI-generated summary |
| `tags` | text[] | |
| `is_reusable` | bool | true = workspace library object |
| `status` | ObjectStatus | draft / active / archived / trashed |
| `current_version_id` | uuid nullable | points to object_versions |
| `origin_type` | ObjectOriginType | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Source formats for agents (`SkillAgentFormat`)

`markdown`, `json`, `yaml`, `typescript`, `python`

The format is chosen at creation time and cannot be changed afterward. All formats use the code textarea editor (not a rendered preview). Markdown agents are **not** rendered as documents — the raw source is always the editing surface. This keeps Agents distinct from Notes.

---

## Reusable vs local agents

### Workspace-level reusable agents (`is_reusable = true`)

- `box_id = null` — not tied to a specific box
- Appear in the global Agents library at `/app/agents`
- Can be attached into any box by reference via `box_object_attachments`
- Breadcrumb: `Workspace → Agents → [agent name]`
- External writes (MCP, API) must go through proposals

### Box-local agents (`is_reusable = false`)

- `box_id` set — belong to a specific box
- Appear in the box tree alongside notes, files, and skills
- Not accessible from other boxes
- Breadcrumb: `Workspace → [Box name] → [agent name]`

### Attached reusable reference in box context

When a reusable agent is attached into a box, it appears in that box's tree with a reference indicator (↗). Opening it navigates to the canonical agent page. The attachment is a reference — editing the agent affects all boxes where it is attached.

The tree sidebar "New agent" quick-create item creates a **box-local** agent by default, with a scope toggle to create a workspace reusable one instead.

---

## Agent creation

### Entry points

1. **Box quick-create dropdown** — "New agent" item in `BoxQuickCreateMenu` within `TreeSidebar`
2. **Agents library page** — "New agent" button always creates workspace reusable
3. **Import flow** — agents recognized during import can be created with explicit format

### `AgentCreateDialog`

Fields:
- **Name** (required) — validated: non-empty, max 500 chars
- **Scope toggle** (shown in box context) — "Box local" vs "Workspace reusable"
- **Source format** (required select) — permanent; chosen at creation
- **Agent type** (optional select) — taxonomy hint; reasoning / coding / research / etc.
- **Model hint** (optional text) — preferred model identifier; not execution config
- **Description** (optional)
- **System prompt** (optional textarea)
- **Initial source content** (optional monospace textarea)

After creation: navigate to `/app/agents/[agent_id]`.

Controlled mode: pass `open` + `onOpenChange` props; no trigger button rendered.

### Server actions

`createAgentInBoxAction(boxId, params)` — creates a box-local agent.
`createReusableAgentAction(params)` — creates a workspace-level reusable agent.

Both use `createAgent` service → `create_object_with_initial_version` RPC (atomic creation + initial version + workspace_objects registration).

---

## Agent workspace surface

Route: `/app/agents/[agent_id]`

Layout:
```
[top bar: breadcrumb + status badges + History link + More menu]
[agent header: icon + name + badges + description]
[center: six-tab surface (fills remaining height)]
[right aside: AgentContextPanel (hidden lg:flex, w-72)]
```

### Six-tab center surface

#### Overview
Structured human-readable summary. Sections:
- Status banner (archived/trashed only)
- Identity: name, reusable/local badge, agent type badge, format badge, status
- Core: model hint, agent type, source format, content size
- System prompt preview (first 6 lines, truncated)
- Summary (AI-generated, if any)
- Tags
- At a glance: relationship count, version count, attachment count
- Location: workspace/box breadcrumb
- Timeline: current version ID, created date, last updated relative

The Overview makes the agent understandable before the user opens raw source.

#### Source
Canonical editable source. The single writable source of truth.
- All formats (including markdown) use the code textarea editor
- Toolbar: agent type badge + format label + line count (left), AutosaveStatus + Retry (right)
- Autosave debounce: 2000ms
- `AUTOSAVE_DEBOUNCE_MS = 2000` (same as Files)
- Version created on each save via `update_object_and_create_version` RPC
- No mode toggle, no preview, no rendered view

#### Exports
Read-only generated representations derived from the agent's structured core fields.

Always derivable (regardless of canonical format):
1. **Structured summary (JSON)** — `{ name, description, agent_type, model_hint, tags, system_prompt }`
2. **Structured summary (YAML)** — same fields in YAML

Each export has a copy button. A banner confirms these are generated read-only views.
Editing must be done via the Source tab.

Future: more export types when canonical structure is richer (tool list, MCP config, etc.).

#### Children
Files and notes associated with this agent via semantic links. Objects linked with `parent_of` or `child_of` relationship types are shown as structural containment. Other relationship types are shown as associations.

Empty state guides users to the Relationships tab to link files and notes.

**Current limitation:** True database-level containment (an `agent_id` FK on files) requires a future DB migration. The current implementation uses the `object_links` system as a foundation, which is honest and composable.

#### Skills
Skills and files referenced by this agent via outgoing semantic links.

- "Depends on" links are shown prominently as **dependencies** (stronger visual)
- Other relationship types are shown as **associations** (lighter visual)
- Skills and files shown in separate sections

Empty state guides users to the Relationships tab to add skill/file links.

#### Relationships
The full `AgentObjectLinksPanel` — outgoing ("This agent →") and incoming ("→ Referred by") semantic links. Supports creating new links via a dialog.

---

## Right context panel (`AgentContextPanel`)

Three tabs:
- **Info**: name, reusable/local badge, agent type, format, core fields (model hint, agent type), system prompt preview, size, tags, summary, location breadcrumb, version (id, created, updated)
- **Links**: `AgentObjectLinksPanel` (same as Relationships tab, compact)
- **History**: immutable version list; `VersionItem` per version with number, relative date, change_origin

No Bundle tab — agents do not have context bundles in this version.

---

## Source editing

`AgentSourceEditor` — client component.

- Handles ALL canonical formats (markdown, json, yaml, typescript, python) with a code textarea
- `AUTOSAVE_DEBOUNCE_MS = 2000`
- AutosaveState machine: `"idle" | "unsaved" | "saving" | "saved" | "error"`
- `isSavingRef` guard prevents concurrent saves
- `lastSavedContentRef` prevents no-op saves
- Reset effect on `[agent.id, agent.current_version_id]`
- Save action: `saveAgentAction` → `updateAgentContent` → `update_object_and_create_version` RPC
- Max content: 500,000 bytes

---

## Semantic relationships

Agents participate in `object_links` (same as Files, Skills). Supported link endpoints:
- Agent ↔ Note
- Agent ↔ File
- Agent ↔ Skill
- Agent ↔ Agent

Same 10-value relationship vocabulary: `related`, `depends_on`, `parent_of`, `child_of`, `reference_for`, `extends`, `example_of`, `sibling_of`, `supersedes`, `derived_from`.

Each link has an optional `relationship_note` annotation.

`createAgentObjectLinkAction` / `deleteAgentObjectLinkAction` in `src/app/app/agents/actions.ts`.

The eligible targets for link creation depend on the agent's context:
- **Box-local agent**: notes, files, skills, and agents from the same box
- **Workspace-level reusable agent**: workspace-level reusable skills and agents

---

## Lifecycle

States: `draft → active → archived → trashed`

`AgentLifecycleMenu` (top bar "More" button):
- Active/Draft: Archive | Move to trash (with confirmation)
- Archived: Unarchive | Move to trash
- Trashed: Restore

`updateAgentStatusAction` → `updateAgent` repository. `router.refresh()` client-side after success.

Status shown as a badge in the top bar when archived or trashed.

---

## Trust model

**Reusable agents (is_reusable = true):**
External writes (MCP, API connections) must go through proposals (same as workspace-level notes and skills). The `AgentSourceEditor` is the human editing surface only.

**Version history:** Immutable. Each save creates a new `object_versions` row via the `update_object_and_create_version` RPC. Versions are never modified or deleted.

**Audit events:** Written on create, update, attach via `writeAgentAudit`. Errors are swallowed (non-blocking), events are append-only.

**No rollback in this version.** The history panel shows versions but does not expose a rollback action yet.

---

## Search, graph, overview, and bundle groundwork

Agents are indexed in `workspace_objects` on creation. This gives them:
- **Search**: searchable by name/display_name via workspace_objects queries
- **Graph**: agents are nodes in the box graph (connected via object_links edges)
- **Overview**: agents appear as object nodes in the box overview
- **Bundle**: agents can be referenced in context bundles as first-class objects (future: bundle center node)

The `agent_type` badge provides visual differentiation in card/list/graph views.

---

## Components

| Component | Purpose |
|---|---|
| `AgentTypeBadge` | Compact badge for agent type taxonomy (reasoning, coding, etc.) |
| `AgentReferenceBadge` | Communicates reusable/local/attached state |
| `AgentSourceEditor` | Code textarea editor; autosave; format/type in toolbar |
| `AgentOverviewPanel` | Overview tab: structured readable summary |
| `AgentExportsPanel` | Exports tab: read-only generated JSON/YAML from structured core |
| `AgentChildrenPanel` | Children tab: associated files/notes via object_links |
| `AgentSkillsPanel` | Skills tab: skill/file references, strong vs associative |
| `AgentObjectLinksPanel` | Semantic links panel; outgoing/incoming; create/delete |
| `AgentContextPanel` | Right pane: Info/Links/History tabs |
| `AgentLifecycleMenu` | Archive/unarchive/trash/restore; inline confirm |
| `AgentCreateDialog` | Creation dialog: name, format, type, model hint, system prompt, content |

---

## Routes

| Route | Description |
|---|---|
| `/app/agents` | Workspace-level reusable agents library |
| `/app/agents/[agent_id]` | Full agent workspace surface (six tabs + right pane) |
| `/app/agents/[agent_id]?tab=source` | Direct link to Source tab |
| `/app/agents/[agent_id]?tab=history` | Direct link to History (right pane) |

Box-local agents are accessed via `/app/agents/[agent_id]` regardless of where they live. The breadcrumb adjusts based on `is_reusable` and `box_id`.

---

## Server actions (`src/app/app/agents/actions.ts`)

| Action | Description |
|---|---|
| `saveAgentAction(agentId, params)` | Save source content and metadata via updateAgentContent RPC |
| `createAgentInBoxAction(boxId, params)` | Create a box-local agent |
| `createReusableAgentAction(params)` | Create a workspace-level reusable agent |
| `updateAgentStatusAction(agentId, status)` | Update lifecycle status |
| `createAgentObjectLinkAction(...)` | Create a semantic relationship link |
| `deleteAgentObjectLinkAction(linkId)` | Delete a semantic relationship link |

---

## Known limitations and follow-ons

1. **True child file containment** — DONE. Files and folders now carry
   `parent_agent_id` FK columns (migration
   `20260412000001_skill_agent_child_containment.sql`). The Children tab
   continues to maintain `object_links` rows for the heterogeneous
   semantic model in addition to the direct FK.
2. **Reusable workspace agents can now own child folders** — DONE. The
   same migration made `folders.box_id` nullable and added a direct
   `workspace_id` column, so reusable agents (box_id = null) can own
   workspace-level folders and files.
3. **Source format immutability** is enforced at the service layer.
   Adding a format migration path requires careful versioning design.
4. **No rollback** in the History tab. Add it in the versioning
   follow-on.
5. **No bundle tab** for agents. The context bundle system currently
   targets notes. Extending it to agents is a follow-on.
6. **Limited reusable agent link targets** — workspace-level reusable
   agents can only link to other workspace-level objects. Cross-box
   linking would require a different authorization model.
7. **SKILL_AGENT_FORMATS** is defined in the object constants module
   with the current supported value set. Extending to additional
   formats requires both the constant update and a DB migration to
   update the CHECK constraint on `files.canonical_format`.
