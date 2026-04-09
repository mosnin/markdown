# Context Bundle V1

This document describes the context bundle — Context Store's first structured retrieval package, designed for handing bounded context to AI tools, APIs, and MCP clients.

---

## What a context bundle is

A **context bundle** is a bounded, deterministic, explainable package of context centered on one target note. It answers the question: "What does a tool need to know about this note and its immediate context?"

A context bundle is **not**:

| What | Why it's different |
|---|---|
| **Guide note** | A guide note is a specific note assigned to a box via `boxes.guide_note_id`. A bundle _includes_ the guide note (optionally), but is not the same thing. |
| **Box guide** | The box guide is a structured summary panel for the whole box. A bundle is centered on one note. |
| **Box overview** | The box overview shows the entire box hierarchy and all link edges. A bundle is bounded to one note's explicit connections. |
| **Export package** | An export package serializes content to a file format. A bundle is an in-memory read model with no file output. |

---

## Bundle output shape

```
ContextBundle {
  target_note          — the note the bundle is about
  box                  — the box it belongs to
  parent_path          — ancestor folder chain (root → parent folder)
  guide_note?          — the box's guide note (if assigned and requested)
  linked_notes[]       — explicitly linked notes, ranked and bounded
  ancestor_summary?    — a single ancestor note from the folder chain (if found)
  relationship_edges[] — link edges for included linked_notes only
  version_info         — current version metadata for target_note
  truncated            — true if any bound was hit or content was excluded
  truncation_reasons[] — machine-readable reasons
  assembly_metadata    — options used and total availability counts
}
```

See `src/server/domain/types/context_bundle.ts` for full type definitions with field-level documentation.

---

## Assembly pipeline

The assembly is performed by `assembleContextBundle()` in `src/server/services/context_bundle_service.ts`.

**Required order:**

1. Resolve target note (`getNoteById`)
2. Verify workspace ownership via the note's box (`box.workspace_id === workspaceId`)
3. Resolve current version metadata (`getNoteVersionById` for `current_version_id`)
4. Build parent path — walk up folder chain via `parent_folder_id` from note's folder to root
5. Include guide note — if `include_guide = true` and `box.guide_note_id` is set and is not the target
6. Fetch all explicit links (`listLinksFromNote` + `listLinksToNote`)
7. Resolve linked note objects (`getNotesByIds`); filter by status and box membership
8. Rank and limit linked notes (see Ranking below)
9. Resolve ancestor summary note (see Ancestor Summary below)
10. Apply deduplication (see Deduplication below)
11. Build `relationship_edges` — edges only for notes in `linked_notes`
12. Collect `truncation_reasons`
13. Return `ContextBundle`

---

## Linked note ranking

Linked notes are ranked by these criteria **in order**:

### 1. Relationship importance (lower = higher priority)

| Relationship type | Importance score |
|---|---|
| `references` | 2 |
| `extends` | 3 |
| `related` | 6 |
| `supersedes` | 10 |
| `contradicts` | 11 |
| _(unknown)_ | 7 |

When a note is linked in **both directions** (bidirectional), the direction with the lower importance score is used.

### 2. Read hint priority (within same importance tier)

| `read_hint` value | Priority |
|---|---|
| `core_reference` | 1 (highest) |
| `read_first` | 2 |
| any other non-null | 3 |
| null | 4 (lowest) |

### 3. `retrieval_priority` descending (0–10)

### 4. `updated_at` descending

### 5. Stable `id` ascending (deterministic tie-break)

---

## Ancestor summary resolution

The ancestor summary note is a single note selected from the target note's folder ancestors. It is intended to represent an "orientation" document for the surrounding context.

**Algorithm:**

1. If the target note has no `folder_id` (root-level note), return null.
2. Start at `folder_id` (the target note's own folder).
3. At each folder level, query active non-trashed notes in that folder.
4. Filter: note must have `read_hint IN ('core_reference', 'read_first')`.
5. Exclude: target note, guide note (if included), and all notes already in `linked_notes`.
6. Rank candidates at this level by:
   a. `read_hint`: `core_reference` before `read_first`
   b. Title: exact `"Overview"` → exact `"Summary"` → others
   c. `retrieval_priority` descending
   d. `updated_at` descending
   e. `id` ascending (stable)
7. If candidates exist at this level, return the top-ranked one.
8. Otherwise, walk to `parent_folder_id` and repeat.
9. If the root of the folder chain is reached with no candidates, return null.

**Constraints:**
- Does not search the whole box — only ancestors of the note's folder
- Does not use semantic heuristics
- Walks at most 20 folder levels (safety limit)
- Only `read_hint` values `core_reference` and `read_first` make a note eligible

---

## Deduplication rules

1. `target_note` never appears in `linked_notes`, `guide_note`, or `ancestor_summary_note`.
2. `guide_note` never appears in `linked_notes`.
3. `ancestor_summary_note` never duplicates `target_note`, `guide_note`, or any note in `linked_notes`.
4. Each note ID appears at most once across all fields.
5. If a note is linked in both directions, the more important direction is chosen (lower importance score wins). Each note ID appears only once in `linked_notes`.

---

## Retrieval bounds

| Bound | Value |
|---|---|
| `linked_notes` max | 10 (hard ceiling, configurable 1–10 via option) |
| `guide_note` max | 1 |
| `ancestor_summary_note` max | 1 |
| Trashed content | Never included |
| Archived content | Excluded by default; opt-in via `include_archived: true` |
| Recursive expansion | Not performed |
| Full-box traversal | Not performed |

---

## Truncation reasons

When `truncated = true`, `truncation_reasons` contains one or more of:

| Reason | Cause |
|---|---|
| `linked_limit_reached` | Total qualifying linked notes > `linked_limit` |
| `guide_excluded_by_option` | `include_guide = false` but `box.guide_note_id` is set |
| `ancestor_summary_not_found` | `include_ancestor_summary = true` but no eligible note found |
| `archived_excluded` | One or more linked notes were archived and `include_archived = false` |

---

## Ownership checks

All ownership verification is inside `assembleContextBundle()` in the service layer. Pages and actions must not bypass it.

**Two-hop ownership pattern** (because `notes` has no `workspace_id`):

1. Resolve `note` by `note_id`
2. Resolve `box` by `note.box_id`
3. Verify `box.workspace_id === workspaceId` (from `getRequestContext()`)

The same pattern applies to all notes included in the bundle: they are verified to belong to `box.id` (same box as the target). This implicitly verifies workspace ownership since the box itself was verified.

---

## Assembly options

| Option | Type | Default | Description |
|---|---|---|---|
| `include_guide` | boolean | `true` | Include the box's guide note |
| `include_archived` | boolean | `false` | Include archived linked notes |
| `linked_limit` | integer (1–10) | `10` | Max linked notes |
| `include_ancestor_summary` | boolean | `true` | Attempt ancestor summary resolution |

---

## Audit

A `bundle.read` audit event is written on each bundle assembly (initial page load and each re-assembly via controls).

Metadata: `note_id`, `box_id`, `linked_count`, `guide_included`, `ancestor_summary_included`, `truncated`.

---

## UI

The bundle is rendered in the **Context Bundle tab** on the note page (`/app/notes/[note_id]`). Users can adjust options (guide on/off, ancestor summary on/off, linked limit) and the bundle re-assembles via the `assembleContextBundleAction` server action.

---

## read_hint conventions

The following `read_hint` string values have special meaning in bundle assembly:

| Value | Meaning |
|---|---|
| `core_reference` | This note is a core reference document. Eligible as ancestor summary (highest priority). |
| `read_first` | This note should be read before consuming other notes in the folder. Eligible as ancestor summary. |

These are conventions, not DB enums. Any other free-form `read_hint` value is valid for display but does not affect bundle ranking beyond the "other non-null" tier.

---

## Service and type locations

| File | Purpose |
|---|---|
| `src/server/domain/types/context_bundle.ts` | Typed output shape (shared by UI, API, MCP) |
| `src/server/services/context_bundle_service.ts` | Assembly pipeline and helpers |
| `src/app/app/notes/actions.ts` | `assembleContextBundleAction` server action |
| `src/components/product/context_bundle_viewer.tsx` | Human UI — the bundle viewer |
| `src/server/services/audit_service.ts` | `auditBundleRead()` |
