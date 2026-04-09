# Relationship contract correction V1

Corrects the `note_links` vocabulary to the original Context Store contract and adds `relationship_note` as a first-class field.

---

## What changed

### Problem

The initial schema shipped with 5 relationship types (`related`, `references`, `extends`, `contradicts`, `supersedes`) that did not match the intended 10-value canonical vocabulary. Two types were stale: `references` (renamed from the original spec to `reference_for`) and `contradicts` (no equivalent in the canonical set — mapped to `related`).

`relationship_note` was referenced in the `ManifestLink` type but was not stored anywhere — it was always serialized as `null`.

### Solution

1. **SQL migration** (`20260409000008_relationship_contract_correction.sql`):
   - Adds `relationship_note TEXT` nullable column to `note_links`
   - Migrates stale types: `references` → `reference_for`, `contradicts` → `related`
   - Drops the old 5-value CHECK constraint
   - Adds a new 10-value CHECK constraint matching the canonical vocabulary
   - Updates `search_notes` RPC to include `relationship_note` as a searchable field

2. **Domain constants** (`note_constants.ts`): `RELATIONSHIP_TYPE` updated to 10 canonical values

3. **Domain types** (`note_link.ts`): `NoteLink` now includes `relationship_note: string | null`

4. **Repository** (`note_link_repository.ts`): `CreateNoteLinkInput` accepts optional `relationship_note`

5. **Services**: all services that read/write/return link data updated end-to-end

6. **API routes**: `linked_notes` and `box_overview` return `relationship_note`

7. **Human UI**: `CreateLinkDialog` includes optional relationship note textarea; `LinkedNotesSection` displays it

---

## Canonical relationship vocabulary

10 values. The database CHECK constraint mirrors this list exactly.

| Value | Direction | Description |
|---|---|---|
| `related` | symmetric in spirit | General association — no structural implication |
| `depends_on` | source → target | Source note's understanding depends on target |
| `parent_of` | source → target | Source is a conceptual parent of target |
| `child_of` | source → target | Source is a conceptual child of target |
| `reference_for` | source → target | Source is cited as a reference for target |
| `extends` | source → target | Source builds upon or continues target |
| `example_of` | source → target | Source is a concrete example of target |
| `sibling_of` | symmetric in spirit | Source and target are peer-level notes |
| `supersedes` | source → target | Source replaces or supersedes target |
| `derived_from` | source → target | Source was derived or extracted from target |

### Choosing a type

- Use `related` when the connection is real but the structural relationship isn't clear or important.
- Use `depends_on` when a reader cannot understand the source without first reading the target.
- Use `parent_of` / `child_of` for explicit hierarchy that the folder structure doesn't express.
- Use `reference_for` when the source note cites or credits the target.
- Use `extends` when the source builds on the target's ideas rather than replacing them.
- Use `example_of` for concrete demonstrations of an abstract concept note.
- Use `sibling_of` for notes at the same conceptual level within a domain.
- Use `supersedes` when the source renders the target obsolete or outdated.
- Use `derived_from` when the source was generated, summarized, or extracted from the target.

---

## relationship_note field

An optional free-form annotation on each link. Describes the specific nature of the connection beyond what the `relationship_type` captures.

**Examples:**
- `extends` link with `relationship_note`: "Extends the authentication model described in this note with OAuth support"
- `depends_on` link with `relationship_note`: "The key rotation algorithm here only makes sense after understanding the token lifecycle"
- `related` link with `relationship_note`: "These two approaches solve the same problem differently — see both before deciding"

### Searchability

`relationship_note` is included in full-text search. The `search_notes` SQL function matches notes whose linked notes (either direction) have matching `relationship_note` text. This means:

- Searching for "OAuth" returns notes that have links with `relationship_note` mentioning "OAuth"
- The note's own FTS rank is unaffected — the `relationship_note` match contributes to note inclusion but not rank
- Rank is still computed from the note's `search_vector` (title, tags, summary, body)

### Export and import

`relationship_note` is included in `ManifestLink` on export and preserved on import. The `ManifestLink.relationship_note` field was previously defined but always serialized as `null`. It now carries the actual value.

---

## Data migration

Existing link data is migrated deterministically:

| Old value | New value | Rationale |
|---|---|---|
| `references` | `reference_for` | Semantic rename — same intent, aligned vocabulary |
| `contradicts` | `related` | No equivalent in canonical set; conservative fallback |

`extends`, `supersedes`, and `related` map to themselves unchanged.

---

## Importance ordering for context bundles

The context bundle service ranks linked notes by relationship importance. Lower score = higher priority in the bundle.

| Type | Score | Rationale |
|---|---|---|
| `depends_on` | 1 | Critical dependency — must be read first |
| `parent_of` | 2 | Structural hierarchy — parent orients the child |
| `child_of` | 3 | Structural hierarchy — directly scoped to source |
| `derived_from` | 4 | Derivation chain — foundational to source |
| `extends` | 5 | Builds upon — strong conceptual link |
| `reference_for` | 6 | Citation — important but not structural |
| `example_of` | 7 | Concrete example — useful but not primary |
| `related` | 8 | General association |
| `sibling_of` | 9 | Peer-level — less directive than hierarchical |
| `supersedes` | 10 | Historical replacement — read for completeness |

---

## API surface

### `GET /api/v1/notes/[note_id]/linked_notes`

Links now include `relationship_note`:

```json
{
  "data": {
    "note_id": "...",
    "links": [
      {
        "id": "...",
        "source_note_id": "...",
        "target_note_id": "...",
        "relationship_type": "extends",
        "relationship_note": "Extends the core data model with versioning support",
        "created_at": "...",
        "direction": "outgoing"
      }
    ],
    "notes": [...]
  }
}
```

### `GET /api/v1/boxes/[box_id]/box_overview`

Edges now include `relationshipNote`:

```json
{
  "data": {
    "edges": [
      {
        "id": "...",
        "sourceNoteId": "...",
        "targetNoteId": "...",
        "relationshipType": "depends_on",
        "relationshipNote": "..."
      }
    ]
  }
}
```

### `POST /api/v1/context_bundles`

`linked_notes` and `relationship_edges` now include `relationship_note`:

```json
{
  "linked_notes": [
    {
      "relationship_type": "depends_on",
      "relationship_note": "...",
      "direction": "outgoing",
      "link_id": "..."
    }
  ],
  "relationship_edges": [
    {
      "link_id": "...",
      "source_note_id": "...",
      "target_note_id": "...",
      "relationship_type": "depends_on",
      "relationship_note": "..."
    }
  ]
}
```

---

## Human UI

### CreateLinkDialog

The link creation dialog now includes:
- All 10 relationship types (with descriptive labels)
- Optional `relationship_note` textarea

### LinkedNotesSection

Each link row now:
- Displays the canonical relationship type label
- Shows `relationship_note` as secondary text beneath the note title when present

---

## What was not changed

- Link directionality semantics (source → target)
- The `UNIQUE (source_note_id, target_note_id, relationship_type)` constraint — two notes can still have multiple links of different types
- Same-box enforcement (service layer, not DB CHECK)
- Audit events for link operations — still fired on create and delete
- No UPDATE policy on `note_links` — changing fields is still delete + re-insert
