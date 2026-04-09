# Vocabulary Normalization V1

This document records the canonical vocabulary corrections applied in V1 and explains the rationale for each change.

---

## What changed and why

Several enum vocabularies drifted from their original intended contract during early development. This migration corrects them end-to-end: SQL constraints, TypeScript constants, service layer, API responses, and UI labels.

---

## 1. `notes.origin_type`

### Before → After

| Old value | New value |
|---|---|
| `human` | `user_created` |
| `generated` | `generated_by_tool` |
| `imported` | `imported` (unchanged) |

### New 5-value vocabulary

| Value | Meaning |
|---|---|
| `user_created` | Created by the authenticated human owner via the UI |
| `imported` | Created via the import service from an external package |
| `generated_by_tool` | Created by an AI connection (MCP client, API token) |
| `duplicated` | Created as a copy of another note |
| `restored` | Re-created from a trashed note |

### Rationale

`human` was ambiguous (all notes in a personal knowledge store are ultimately human-owned). `user_created` is explicit. `generated` was too vague — `generated_by_tool` makes the source clear, and avoids collision with `change_origin='generated'` (a separate vocabulary on `note_versions`).

### Data migration

```sql
UPDATE notes SET origin_type = 'user_created'      WHERE origin_type = 'human';
UPDATE notes SET origin_type = 'generated_by_tool' WHERE origin_type = 'generated';
```

### RPC changes

`create_note_with_initial_version` now accepts:
- `p_origin_type text DEFAULT 'user_created'`
- `p_change_origin text DEFAULT 'human_edit'`

Import flows pass `p_origin_type='imported'` and `p_change_origin='import'` directly — no separate UPDATE after the RPC.

`approve_write_proposal_create` and `create_generated_note_with_version` use `origin_type='generated_by_tool'`.

---

## 2. `notes.read_hint`

### New 6-value CHECK constraint

Previously unconstrained free text. Now enforced as one of these values (or NULL):

| Value | Meaning |
|---|---|
| `read_first` | Read this note before other notes in its folder |
| `core_reference` | Primary reference document; highest ancestor summary priority |
| `supporting_context` | Useful background; not required reading |
| `related` | Loosely related; consult if relevant |
| `archive_only` | Retained for history; not current |
| `generated` | Created by an AI tool; review before relying on |

### Migration

Existing values that do not match the 6 canonical values are set to NULL. The `context_bundle_v1.md` ancestor summary algorithm continues to use `core_reference` and `read_first` as the eligibility filter.

### Note

`read_hint` is separate from relationship ranking. It is a per-note annotation for AI readers. The values `core_reference` and `read_first` have special meaning in the bundle assembly pipeline (ancestor summary resolution). The other values are informational labels.

---

## 3. `connections.connection_type`

### Before → After

| Old value | New value |
|---|---|
| `api` | `api_token` |
| `webhook` | `internal` |
| `mcp` | `mcp` (unchanged) |

### New 3-value vocabulary

| Value | Meaning |
|---|---|
| `mcp` | Model Context Protocol client |
| `api_token` | REST API integration using a bearer token |
| `internal` | Internal service-to-service integration |

### Rationale

`api` was ambiguous — all connections use tokens. `api_token` is precise. `webhook` was incorrect for what was being described (push-based webhooks were never implemented). `internal` reflects the actual use case.

---

## 4. `connections.status`

### Before → After

| Old value | New value |
|---|---|
| `suspended` | `paused` |

### New 3-value vocabulary

| Value | Meaning |
|---|---|
| `active` | Connection is live and can authenticate |
| `paused` | Temporarily disabled; token remains valid but requests are rejected |
| `revoked` | Permanently disabled; cannot be reactivated |

### Rationale

`suspended` has legal connotations. `paused` is more accurate for a temporary operational hold.

---

## 5. `change_origin` (unchanged)

`change_origin` on `note_versions` is a separate vocabulary and was already correct:

| Value | Meaning |
|---|---|
| `human_edit` | Version created by the human owner via the editor |
| `import` | Version created via the import service |
| `generated` | Version created by an AI connection directly |
| `proposal_approved` | Version created when a write proposal was approved |
| `rollback` | Version created when reverting to a prior version |

These values are **not** renamed. The `origin_type` rename does not cascade to `change_origin`.

---

## TypeScript constants

### `NOTE_ORIGIN_TYPE` (in `note_constants.ts`)

```typescript
export const NOTE_ORIGIN_TYPE = {
  USER_CREATED:      "user_created",
  IMPORTED:          "imported",
  GENERATED_BY_TOOL: "generated_by_tool",
  DUPLICATED:        "duplicated",
  RESTORED:          "restored",
} as const;
```

### `NOTE_READ_HINT` (new, in `note_constants.ts`)

```typescript
export const NOTE_READ_HINT = {
  READ_FIRST:         "read_first",
  CORE_REFERENCE:     "core_reference",
  SUPPORTING_CONTEXT: "supporting_context",
  RELATED:            "related",
  ARCHIVE_ONLY:       "archive_only",
  GENERATED:          "generated",
} as const;
```

### `CONNECTION_TYPE` (in `connection_constants.ts`)

```typescript
export const CONNECTION_TYPE = {
  MCP:       "mcp",
  API_TOKEN: "api_token",
  INTERNAL:  "internal",
} as const;
```

### `CONNECTION_STATUS` (in `connection_constants.ts`)

```typescript
export const CONNECTION_STATUS = {
  ACTIVE:  "active",
  PAUSED:  "paused",
  REVOKED: "revoked",
} as const;
```

---

## Migration file

`supabase/migrations/20260409000009_vocabulary_normalization.sql`

---

## Audit events

Audit events written before this migration retain their original vocabulary values. Events written after use the corrected values. Old rows are not rewritten.

---

## Affected files

| File | Change |
|---|---|
| `supabase/migrations/20260409000009_vocabulary_normalization.sql` | Data migration + constraint updates + RPC replacements |
| `src/server/domain/constants/note_constants.ts` | `NOTE_ORIGIN_TYPE` corrected; `NOTE_READ_HINT` added |
| `src/server/domain/constants/connection_constants.ts` | `CONNECTION_TYPE` and `CONNECTION_STATUS` corrected |
| `src/server/domain/schemas/note_schemas.ts` | `origin_type` enum + default updated; `read_hint` validated against enum |
| `src/server/services/import_service.ts` | Passes `p_origin_type='imported'` and `p_change_origin='import'` to RPC; separate UPDATE removed |
| `src/server/services/generated_note_service.ts` | Uses `NOTE_READ_HINT.GENERATED` constant |
| `src/components/product/connections_panel.tsx` | Type labels and default state updated |
| `src/server/services/system_guide_service.ts` | Relationship types corrected to canonical 10-value list |
