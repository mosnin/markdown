# Data Model

This document describes Context Store's relational data model: tables, relationships, key constraints, and design decisions.

---

## Overview

Context Store's storage hierarchy is:

```
Workspace
  └── Box
        ├── Folder (optional)
        │     └── Note
        └── Note (root-level)
              └── NoteVersion (immutable history)
              └── NoteLink (directional relationship)
```

Supporting entities:

- **Connection** — an authorized external agent (MCP client, API integration)
- **ConnectionToken** — a credential for a connection (hashed secret, prefix for lookup)
- **ConnectionBoxScope** — which boxes a connection can access
- **WriteProposal** — a connection's proposed note change, pending human review
- **AuditEvent** — immutable append-only event log

---

## Tables

### `workspaces`

Top-level organizational unit. In V1, each user owns exactly one workspace, created automatically on first authenticated access.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid | references `auth.users` |
| `name` | text | display name |
| `slug` | text | URL-safe, unique per owner |
| `description` | text | nullable |
| `status` | text | `'active'` \| `'archived'` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | auto-maintained by trigger |

**Constraints:** `UNIQUE (owner_id, slug)` — slug uniqueness is scoped to the owner.

---

### `boxes`

A focused collection within a workspace — analogous to a project, topic, or domain.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | → `workspaces` |
| `name` | text | |
| `slug` | text | URL-safe |
| `description` | text | nullable |
| `status` | text | `'active'` \| `'archived'` \| `'trashed'` |
| `guide_note_id` | uuid | nullable FK → `notes` (set via ALTER TABLE) |
| `retrieval_priority` | integer | higher = surfaced first in AI context retrieval |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Guide note canonical location:** `boxes.guide_note_id` is the authoritative field for marking which note is the guide for a box. There is no `is_guide_note` column on `notes`.

**Constraints:** `UNIQUE (workspace_id, slug)` excluding trashed rows.

---

### `folders`

Optional grouping within a box. Purely structural — no semantic meaning beyond organization.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `box_id` | uuid FK | → `boxes` |
| `parent_folder_id` | uuid | nullable FK → `folders` (self-reference) |
| `name` | text | |
| `slug` | text | |
| `path_cache` | text | full path string, maintained by service layer |
| `description` | text | nullable |
| `accepts_generated_notes` | boolean | whether AI connections may create notes here |
| `status` | text | `'active'` \| `'archived'` \| `'trashed'` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**path_cache:** Denormalized full path (e.g. `"research/papers/ml"`). Not computed by the repository — the service layer must maintain this value when slugs or parent relationships change.

---

### `notes`

The primary content unit. Markdown document with metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `box_id` | uuid FK | → `boxes` |
| `folder_id` | uuid | nullable FK → `folders` |
| `current_version_id` | uuid | nullable FK → `note_versions` (set via ALTER TABLE) |
| `generated_by_connection_id` | uuid | nullable FK → `connections` |
| `title` | text | |
| `markdown_content` | text | current body |
| `content_bytes` | integer | byte length of markdown_content, maintained by service |
| `path_cache` | text | full path, maintained by service layer |
| `kind` | text | `'note'` \| `'guide'` \| `'bundle'` |
| `origin_type` | text | `'human'` \| `'connection'` \| `'import'` |
| `status` | text | `'active'` \| `'archived'` \| `'trashed'` |
| `retrieval_priority` | integer | higher = surfaced first in AI retrieval |
| `tags` | text[] | free-form labels |
| `metadata` | jsonb | nullable, arbitrary structured metadata |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Note kinds:** `kind = 'guide'` identifies the note as a guide-style document, but the canonical _assignment_ of a guide to a box is `boxes.guide_note_id`. The `kind` field is about the note's inherent nature; the box FK is the pointer.

---

### `note_versions`

Immutable full-content snapshots of a note's state. Never mutated after creation.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `note_id` | uuid FK | → `notes` |
| `parent_version_id` | uuid | nullable FK → `note_versions` (linked list) |
| `version_number` | integer | monotonically increasing per note, starting at 1 |
| `title` | text | snapshot of title at this version |
| `markdown_content` | text | full content snapshot |
| `content_bytes` | integer | byte length |
| `actor_type` | text | `'user'` \| `'connection'` \| `'system'` |
| `actor_id` | text | uuid (user/connection) or `'system'` |
| `change_origin` | text | `'human_edit'` \| `'connection_write'` \| `'import'` \| `'system'` |
| `diff_summary` | jsonb | lightweight description of changes (field names, deltas) |
| `diff_patch` | text | optional full unified diff for audit/revert |
| `created_at` | timestamptz | |

No `updated_at` — immutable by design.

---

### `note_links`

Explicit directed relationships between notes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_note_id` | uuid FK | → `notes` |
| `target_note_id` | uuid FK | → `notes` |
| `relationship_type` | text | one of 10 canonical values (see below) |
| `relationship_note` | text | nullable — optional annotation describing the specific link |
| `created_at` | timestamptz | |

**Canonical `relationship_type` values (10):**
`related`, `depends_on`, `parent_of`, `child_of`, `reference_for`, `extends`, `example_of`, `sibling_of`, `supersedes`, `derived_from`

See [docs/relationship_contract_correction_v1.md](relationship_contract_correction_v1.md) for the full vocabulary, importance ordering, and data migration history.

**Constraints:**
- `CHECK (relationship_type IN (...))` — database-enforced 10-value vocabulary.
- `CHECK (source_note_id <> target_note_id)` — no self-links, enforced by the database.
- `UNIQUE (source_note_id, target_note_id, relationship_type)` — no duplicate links per type.
- Same-box enforcement is the service layer's responsibility (cannot be expressed as a DB CHECK without a subquery).

**`relationship_note`:** Searchable via `search_notes` RPC — notes appear in results if any connected link has a matching `relationship_note`. Preserved in export manifests and import packages.

---

### `connections`

An authorized external agent (MCP client, webhook, API integration) with scoped access to one workspace.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | → `workspaces` |
| `name` | text | |
| `description` | text | nullable |
| `connection_type` | text | `'mcp'` \| `'webhook'` \| `'api_integration'` |
| `status` | text | `'active'` \| `'suspended'` \| `'revoked'` |
| `permission_mode` | text | `'read_only'` \| `'propose_writes'` \| `'full_write'` |
| `last_used_at` | timestamptz | nullable |
| `usage_count` | integer | |
| `metadata` | jsonb | nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `connection_tokens`

Credential tokens for connections. The raw secret is never stored — only a prefix (for lookup) and a hashed secret (for verification).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `connection_id` | uuid FK | → `connections` |
| `token_prefix` | text UNIQUE | first ~8 chars of raw token (for lookup) |
| `secret_hash` | text | bcrypt/argon2 hash of full secret |
| `label` | text | nullable, human-readable label |
| `status` | text | `'active'` \| `'revoked'` \| `'expired'` |
| `expires_at` | timestamptz | nullable |
| `last_used_at` | timestamptz | nullable |
| `revoked_at` | timestamptz | nullable |
| `created_at` | timestamptz | |

Revocation is done via `updateConnectionToken({ status: 'revoked', revoked_at })` — no hard delete.

---

### `connection_box_scopes`

Join table: which boxes a connection is granted access to. The box is the scope unit in V1.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `connection_id` | uuid FK | → `connections` |
| `box_id` | uuid FK | → `boxes` |
| `created_at` | timestamptz | |

**Constraint:** `UNIQUE (connection_id, box_id)`.

---

### `write_proposals`

A connection's proposed note creation or modification, pending human review.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | → `workspaces` |
| `connection_id` | uuid FK | → `connections` |
| `target_note_id` | uuid | nullable FK → `notes` |
| `target_version_id` | uuid | nullable FK → `note_versions` (version at submission time) |
| `proposal_type` | text | `'create_note'` \| `'update_note'` |
| `status` | text | `'pending'` \| `'approved'` \| `'rejected'` \| `'conflicted'` \| `'expired'` |
| `proposed_title` | text | nullable |
| `proposed_content` | text | nullable |
| `proposed_folder_id` | uuid | nullable FK → `folders` |
| `rationale` | text | nullable |
| `reviewer_id` | uuid | nullable, set on review |
| `reviewed_at` | timestamptz | nullable |
| `review_note` | text | nullable |
| `approved_note_id` | uuid | nullable, set when create_note is approved |
| `approved_version_id` | uuid | nullable |
| `expires_at` | timestamptz | nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Conflict detection:** Services should compare `target_version_id` against the note's `current_version_id` before presenting a proposal for review. If the note has advanced, the proposal status should be set to `'conflicted'`.

---

### `audit_events`

Append-only immutable event log. Never mutated after creation.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | → `workspaces` |
| `actor_type` | text | `'user'` \| `'connection'` \| `'system'` |
| `actor_id` | text | uuid or `'system'` |
| `object_type` | text | entity kind (e.g. `'note'`, `'box'`) |
| `object_id` | text | entity uuid as text |
| `event_type` | text | dot-separated label (e.g. `'note.created'`, `'box.archived'`) |
| `metadata` | jsonb | nullable, structured event detail |
| `created_at` | timestamptz | |

No `updated_at` — immutable by design.

---

## Row Level Security

RLS is enabled on all 11 tables. Policies use a SECURITY DEFINER helper:

```sql
CREATE FUNCTION owns_workspace(wid uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspaces WHERE id = wid AND owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

**Policy summary:**

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| workspaces | `owner_id = auth.uid()` | same | same | — |
| boxes | `owns_workspace(workspace_id)` | same | same | — |
| folders | through box → workspace | same | same | — |
| notes | through box → workspace | same | same | — |
| note_versions | through note → box → workspace | same | **none** | **none** |
| note_links | through source note → box → workspace | same | **none** | same |
| connections | `owns_workspace(workspace_id)` | same | same | — |
| connection_tokens | through connection → workspace | same | same | **none** |
| connection_box_scopes | through connection → workspace | same | — | same |
| write_proposals | `owns_workspace(workspace_id)` | same | same | — |
| audit_events | `owns_workspace(workspace_id)` | same | **none** | **none** |

Note versions and audit events have no UPDATE or DELETE policies — they are immutable by design.

---

## Soft Delete Convention

All content entities use a `status` column for soft deletion rather than hard DELETE:

- `'active'` — visible and accessible
- `'archived'` — hidden from default views, accessible via opt-in filter
- `'trashed'` — excluded from all queries; uniqueness indexes exclude trashed rows

Hard deletes are not issued by application code. Future retention/purge jobs may hard-delete trashed rows after a grace period.

---

## Migration Files

| File | Contents |
|---|---|
| `supabase/migrations/20260409000001_core_schema.sql` | All 11 tables, indexes, triggers, helper functions |
| `supabase/migrations/20260409000002_rls_policies.sql` | RLS enable + all policies |
| `supabase/migrations/20260409000003_note_rpc_functions.sql` | Atomic note create and update RPC functions |

Circular FK references are resolved in the schema migration using `ALTER TABLE ... ADD CONSTRAINT` after both tables exist:

- `boxes.guide_note_id → notes`
- `notes.current_version_id → note_versions`
- `notes.generated_by_connection_id → connections`

## Atomic Note Operations

Note creation and editing use Postgres RPC functions to guarantee atomicity:

### `create_note_with_initial_version`

1. `INSERT INTO notes` (current_version_id = NULL)
2. `INSERT INTO note_versions` (version_number = 1, no parent)
3. `UPDATE notes SET current_version_id = <new version id>`

Returns `jsonb: { note: {...}, version: {...} }`

### `update_note_and_create_version`

1. `SELECT * FROM notes WHERE id = p_note_id` (RLS blocks if not owned)
2. Compute `MAX(version_number) + 1`
3. `INSERT INTO note_versions` (parent = current_version_id)
4. `UPDATE notes` content fields + `current_version_id`

Returns `jsonb: { note: {...}, version: {...} }`

Both functions are `SECURITY INVOKER` — RLS policies from the calling user's JWT apply normally.
