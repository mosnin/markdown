# Generated Note Parity Correction V1

This document records the corrections applied to generated note behavior. These changes bring the product closer to the original handoff contract for machine-generated content.

---

## What changed and why

Prior to this correction:
- Generated notes existed but had no human promotion path.
- The `origin_type` field stored `'generated'` (old value) rather than the corrected `'generated_by_tool'` value from the vocabulary normalization.
- Version history had no `change_origin='promotion'` value.
- The note page showed no visual indicator that a note was machine-generated.
- No audit event existed for promotion.

After this correction:
- Generated notes are visibly identified in the human app with a "Generated" badge and an in-context banner.
- Workspace owners can promote a generated note to a standard user-managed note through a deliberate, confirmed action.
- Promotion creates a new note version with `change_origin='promotion'` — legible in history, non-destructive.
- `origin_type` and `generated_by_connection_id` are preserved for provenance after promotion.
- Promotion is **human-only** in V1. External connections cannot promote notes.

---

## 1. What a generated note is

A generated note is a note created directly by an external connection (not via the write proposal path). It carries:

| Field | Value |
|---|---|
| `is_generated` | `true` |
| `origin_type` | `generated_by_tool` |
| `generated_by_connection_id` | UUID of the creating connection |
| `read_hint` | `generated` (default; caller may override) |

Generated notes are created only in folders where:
- `folder.accepts_generated_notes = true` (explicitly designated by the owner)
- The connection has `generate_in_allowed_folders` permission

Generated notes are fully visible in search, tree navigation, version history, context bundles, and exports. They are not hidden or filtered from any retrieval surface.

---

## 2. How generated note creation differs from write proposals

| Aspect | Write proposal | Direct generated note |
|---|---|---|
| Human review | Required | None (pre-authorized by folder policy) |
| Who creates | Any non-read_only connection | `generate_in_allowed_folders` only |
| Folder requirement | Any in-scope folder | `accepts_generated_notes = true` |
| `is_generated` | `true` (until promoted) | `true` (until promoted) |
| `change_origin` | `proposal_approved` | `generated` |

---

## 3. Generated folder rules

Folders that accept generated notes are explicitly designated by the workspace owner. The `accepts_generated_notes` boolean defaults to `false`. Only the owner may change it.

- External tools **cannot create subfolders** in V1.
- A `generate_in_allowed_folders` connection may only create notes (not folders) in authorized folders.
- Moving a generated note to another folder does **not** promote it. Promotion is a separate, explicit action.
- Guide notes cannot be auto-created by external tools.

---

## 4. Generated note promotion

### What happens

1. Owner clicks "Promote to standard note" on the note page.
2. A confirmation dialog appears explaining that history and attribution are preserved.
3. On confirm, the server action calls `promoteGeneratedNote()` in `generated_note_service.ts`.
4. The service calls the `promote_generated_note` SQL function which:
   - Verifies `is_generated = true` and `status != 'trashed'`
   - Inserts a new `note_versions` row with `change_origin = 'promotion'`, `actor_type = 'user'`, same title and markdown content as current state
   - Sets `notes.is_generated = false` and advances `notes.current_version_id`
5. An audit event (`note.promoted_from_generated`) is written.
6. The page refreshes — the banner and "Generated" badge disappear.

### Why promotion creates a new version

Promotion creates a new note version rather than silently updating metadata because:
- It makes the state transition legible in the History tab (version N = "Promoted" with actor info)
- It is consistent with how rollback works (also creates a new version from an existing snapshot)
- It preserves the immutable audit chain — no existing rows are touched

The promotion version carries the same content as the prior version. `diff_summary` is null because no content changed.

### What changes after promotion

| Field | Before | After |
|---|---|---|
| `is_generated` | `true` | `false` |
| `origin_type` | `generated_by_tool` | `generated_by_tool` (unchanged) |
| `generated_by_connection_id` | connection UUID | connection UUID (unchanged, preserved for provenance) |
| `current_version_id` | prior version | new promotion version |

### What does not change

- Guide note assignment is not affected.
- Lifecycle status (active/archived/trashed) is not affected.
- Prior note versions are immutable and untouched.
- Retrieval, search, linking behavior is unchanged after promotion.

---

## 5. Generated note visibility after promotion

After promotion, the note behaves exactly like a user-created note:
- `is_generated = false` — no special handling applied
- The "Generated" badge and banner are no longer shown
- `origin_type` remains `generated_by_tool` — visible in exports and version history for historical accuracy

---

## 6. Import and export behavior

### Export

The export manifest faithfully reflects generated note state at export time:
- `notes[].is_generated` — reflects current `is_generated` value (false after promotion)
- `notes[].origin_type` — reflects `generated_by_tool` (preserved after promotion)

### Import

On import, `origin_type` is always forced to `'imported'` regardless of manifest value. `is_generated` from the manifest is not re-applied — imported notes are always treated as regular imported content, never as currently-generated notes.

---

## 7. Trust semantics

The trust layer remains interpretable:

| State | `is_generated` | `origin_type` | Visible in history |
|---|---|---|---|
| Just created by tool | `true` | `generated_by_tool` | Yes — `change_origin='generated'` |
| Promoted by owner | `false` | `generated_by_tool` | Yes — `change_origin='promotion'` |
| Subsequently edited | `false` | `generated_by_tool` | Yes — `change_origin='human_edit'` |

Promotion does not erase provenance. Users and auditors can always trace a note's origin through version history and the `generated_by_connection_id` field.

---

## 8. Canonical API and MCP

Generated note metadata (`is_generated`, `origin_type`, `generated_by_connection_id`) is included in note read responses from the canonical API.

**Promotion is human-only in V1.** The canonical API does not expose a promotion endpoint. External connections cannot convert generated notes to standard notes. This keeps the trust model explicit: only humans can take ownership of generated content.

The MCP adapter continues to call canonical API endpoints. No MCP tool for promotion is added in this prompt.

---

## 9. Files added or modified

| File | Change |
|---|---|
| `supabase/migrations/20260409000011_generated_note_promotion.sql` | Adds `'promotion'` to `change_origin` constraint; adds `promote_generated_note` RPC |
| `src/server/services/generated_note_service.ts` | Added `promoteGeneratedNote()` function |
| `src/server/services/audit_service.ts` | Added `auditGeneratedNotePromoted()` |
| `src/app/app/notes/[note_id]/actions.ts` | Added `promoteGeneratedNoteAction()` |
| `src/components/product/generated_note_banner.tsx` | New — banner with promote action |
| `src/components/product/note_history_panel.tsx` | Added `'promotion'` to `ORIGIN_LABEL` and `ORIGIN_ICON` |
| `src/app/app/notes/[note_id]/page.tsx` | "Generated" badge; `GeneratedNoteBanner` on edit tab |
| `docs/machine_write_v1.md` | Fixed `origin_type` values; added promotion section |
| `docs/version_history_v1.md` | Added `change_origin='promotion'` to value table |
| `docs/canonical_api_v1.md` | Noted generated note fields; noted promotion is human-only |
