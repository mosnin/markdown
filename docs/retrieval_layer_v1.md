# Retrieval Layer V1

This document describes the deterministic retrieval infrastructure built in V1. It covers explicit note links, full-text keyword search, the system guide, the box guide, and the box overview.

For context bundle retrieval, see [docs/context_bundle_v1.md](context_bundle_v1.md).

---

## Design principle

All retrieval in V1 is **deterministic and explainable**:

- Given the same inputs, the same results are returned.
- Ranking is defined by explicit constants, not learned weights or embeddings.
- There is no semantic retrieval, no vector similarity, no recursive graph traversal.
- Every inclusion decision can be traced to a specific rule.

---

## 1. Explicit note links

### Storage

`note_links` table — directional edges between notes.

| Field | Description |
|---|---|
| `source_note_id` | The note that "points to" the target |
| `target_note_id` | The note being pointed at |
| `relationship_type` | Typed relationship (see below) |

### Relationship types

| Type | Meaning |
|---|---|
| `extends` | Source builds upon or expands the target |
| `references` | Source cites or references the target |
| `supersedes` | Source is the newer, authoritative replacement for the target |
| `related` | General association |
| `contradicts` | Source presents information that conflicts with the target |

### Constraints

- Self-links rejected by a DB `CHECK` constraint.
- Same-box constraint enforced by `link_service.ts` (not expressible as a DB constraint without a subquery).
- No `UPDATE` policy — changing a relationship type requires delete + re-insert.
- `UNIQUE(source_note_id, target_note_id, relationship_type)`.

### API

`src/server/services/link_service.ts`:
- `listLinksForNote(supabase, noteId)` → `{ outgoing, incoming }`
- `createLink(supabase, userId, workspaceId, { sourceNoteId, targetNoteId, relationshipType })`
- `updateLinkRelationshipType(supabase, userId, workspaceId, linkId, newType)`
- `deleteLink(supabase, userId, workspaceId, linkId)`

---

## 2. Keyword search (Postgres FTS)

### Storage

`notes.search_vector` — a stored `tsvector` column maintained by a trigger on `INSERT` or `UPDATE` of searchable columns. A GIN index enables fast queries.

### Weighted fields

| Field | FTS weight | Priority |
|---|---|---|
| `title` | A | Highest |
| `tags` | A | Highest |
| `summary` | B | Medium-high |
| `read_hint` | B | Medium-high |
| `markdown_content` | C | Lowest |

### Ranking (deterministic)

Results from the `search_notes` Postgres RPC are ranked by a composite score:

1. **Exact title match** — `lower(title) = lower(query)` → +4.0 boost
2. **Prefix title match** — `lower(title) LIKE lower(query) || '%'` → +2.0 boost
3. **Weighted FTS score** — `ts_rank_cd(search_vector, tsquery) × 10`
4. **Retrieval priority nudge** — `retrieval_priority / 10.0` (0–1 range)
5. **Tie-break** — `updated_at DESC`

### Scope

Search is always **box-scoped** in V1. Cross-box search is not yet implemented.

### API

`src/server/services/search_service.ts`:
- `searchNotes(supabase, boxId, query, limit?)` → `NoteSearchResult[]`

Calls the `search_notes` Postgres RPC. Returns `[]` for blank or unparseable queries.

---

## 3. System guide

`src/server/services/system_guide_service.ts`

A **static, code-defined** structured description of Context Store's product model. Not stored in the database — it is a pure TypeScript module.

Used by:
- The MCP server (when explaining the product model to AI clients)
- The API layer (for error messages and documentation)
- Retrieval prompts that need to describe the system to an LLM

### API

- `getSystemGuide()` → `SystemGuide` (structured object)
- `getSystemGuideText()` → plain-text summary suitable for LLM system prompts

The system guide includes: entities, note kinds, relationship types, retrieval rules, and write rules.

---

## 4. Box guide

The box guide is a structured **interpretation surface** for a single box. It is rendered in the "Guide" tab on the box page.

**It is not the guide note.** The guide note (`boxes.guide_note_id`) is a specific assigned note. The box guide is a computed panel that aggregates:

- The guide note content and metadata (if assigned)
- High-priority notes (`retrieval_priority > 0`)
- Most-linked notes (by incoming link count)
- Common tags across the box

The box guide is assembled server-side on each page load. There is no caching layer in V1.

**Implementation:** `src/components/product/box_guide_panel.tsx`

---

## 5. Box overview

The box overview shows the full hierarchy (folders + notes) and all intra-box note link edges for a box.

**Hard limits:**
- 1 000 nodes (folders + notes)
- 2 000 edges

When limits are exceeded, `truncated: true` is set and a visible warning is shown.

**Implementation:** `src/server/services/overview_service.ts`, `src/components/product/box_overview_panel.tsx`

---

## Migration

`supabase/migrations/20260409000004_fts_indexes.sql`:
- Adds `search_vector tsvector` column to `notes`
- Adds trigger to maintain it
- Creates GIN index
- Backfills existing rows
- Defines `search_notes(p_box_id, p_query, p_limit)` RPC
