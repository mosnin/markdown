# Machine Write V1

Context Store's machine write layer lets external connections contribute content safely without silently mutating the user's source of truth. Human review is required for changes to existing notes. Direct creation is allowed only in explicitly authorized folders.

---

## Trust model in one sentence

**External tools propose. Humans decide. Context Store applies atomically.**

---

## Two write paths

| Path | Who uses it | Human review | Use for |
|---|---|---|---|
| **Write proposals** | Any non-read_only connection | Required | Changes to existing notes; new notes that need editorial review |
| **Direct generated note creation** | `generate_in_allowed_folders` only | None (pre-authorized by folder policy) | High-confidence ingest output, structured summaries, reference data |

---

## Proposal types

| Type | Description | Required fields |
|---|---|---|
| `create_note` | Propose creating a new note in a folder | `target_folder_id` |
| `update_note` | Propose a full content replacement | `target_note_id`, `target_version_id` (captured automatically) |
| `append_note` | Propose appending markdown to an existing note | `target_note_id`, `target_version_id` (captured automatically) |
| `replace_note` | Full destructive replacement (stronger warning in review UI) | `target_note_id`, `target_version_id` (captured automatically) |

---

## Proposal lifecycle

```
[connection submits proposal]
        ↓
    PENDING
   /       \
APPROVED  REJECTED    ← human decision
   |
CONFLICTED              ← note changed after proposal creation; approval blocked
```

**Status values:**

| Status | Meaning |
|---|---|
| `pending` | Awaiting human review |
| `approved` | Applied atomically; note version created |
| `rejected` | Dismissed by owner; no note change |
| `conflicted` | Note was modified after proposal was created; cannot apply |
| `canceled` | Withdrawn before review (not used by V1 API; reserved) |
| `expired` | Past expires_at without review (enforced by service if set) |

---

## Conflict detection

When a proposal is created for an existing note, the note's `current_version_id` is captured in `proposal.target_version_id`.

At approval time, the SQL function `approve_write_proposal_update` locks the note row and checks:

```
note.current_version_id == proposal.target_version_id?
  YES → apply the change, create new version, mark approved
  NO  → mark conflicted, return conflict outcome, note unchanged
```

This is an optimistic lock. If the note was edited by anyone (human or another approved proposal) between proposal creation and approval, the proposal is marked conflicted rather than silently overwriting the newer state.

Conflicted proposals remain visible in the review UI with a clear "stale" indicator. The connection can re-submit a new proposal based on the current note state.

---

## Atomic approval

Approval is handled by two focused SQL functions (`SECURITY INVOKER`, called via admin client):

### `approve_write_proposal_update`
Handles `update_note`, `append_note`, `replace_note`.

1. Lock proposal row `FOR UPDATE`
2. Lock target note row `FOR UPDATE`
3. Check `note.current_version_id == proposal.target_version_id`
   - Mismatch: mark conflicted, return `{outcome: 'conflicted'}`
4. Compute final content:
   - `append_note`: `existing_content + '\n\n' + proposed_content`
   - `update_note` / `replace_note`: `proposed_content`
5. Insert `note_versions` row (`change_origin = 'proposal_approved'`)
6. Update note fields + `current_version_id`
7. Mark proposal `approved`, set `approved_version_id`
8. Return `{outcome: 'approved', note, version}`

### `approve_write_proposal_create`
Handles `create_note`.

1. Lock proposal row `FOR UPDATE`
2. Verify `proposed_folder_id` still exists (conflict if gone)
3. Insert note (`origin_type='generated_by_tool'`, `is_generated=true`, `generated_by_connection_id=proposal.connection_id`)
4. Insert initial `note_versions` row (`change_origin = 'proposal_approved'`, `actor_type = 'user'`)
5. Link `note.current_version_id = version.id`
6. Mark proposal `approved`, set `approved_note_id`, `approved_version_id`
7. Return `{outcome: 'approved', note, version}`

Both functions run as a single PostgreSQL transaction.

---

## Generated folder policy

Folders have an `accepts_generated_notes` boolean (default `false`). When `true`, connections with `generate_in_allowed_folders` permission may create notes directly without review.

The workspace owner toggles this per-folder via the box right panel (Folder policies section) or via a server action. The setting is audited as `folder.generated_policy_changed`.

**Rules:**
- Only the workspace owner may change the policy
- `create_note` proposals still work even when the flag is false (they go through the approval path)
- The flag does not affect proposal creation or rejection — only the direct creation path

---

## Direct generated note creation

`create_generated_note_with_version` SQL function (called by `generated_note_service.ts`):

Authorization checks (enforced by service layer before calling the function):
1. `connection.permission_mode == 'generate_in_allowed_folders'`
2. `folder.box_id ∈ connection.allowed_box_ids`
3. `folder.accepts_generated_notes == true`
4. `box.workspace_id == connection.workspace_id` (defense in depth)

Note fields set:
- `origin_type = 'generated_by_tool'`
- `is_generated = true`
- `generated_by_connection_id = connection.id`
- `read_hint = 'generated'` (default; caller may override)

Version fields set:
- `actor_type = 'connection'`
- `actor_id = connection.id`
- `change_origin = 'generated'`

**Default title convention:** `<connection_name> YYYYMMDD_HHMMSS` (UTC). Caller may supply their own title.

---

## Permission matrix

| Operation | `read_only` | `propose_writes` | `generate_in_allowed_folders` |
|---|---|---|---|
| Create write proposal | ✗ | ✓ | ✓ |
| Create generated note | ✗ | ✗ | ✓ |
| Read any content | ✓ | ✓ | ✓ |

---

## Generated note promotion

The workspace owner can promote a generated note into a standard user-managed note through the human app. External connections cannot promote notes in V1.

### What happens

1. Owner clicks "Promote to standard note" on the note page.
2. A new `note_version` is created with `change_origin='promotion'`, `actor_type='user'`. The content is identical to the current version — promotion is a metadata state change, not a content change.
3. `notes.is_generated` is set to `false`.
4. `notes.current_version_id` advances to the new promotion version.
5. An audit event (`note.promoted_from_generated`) is written.

### What does not change after promotion

| Field | Value after promotion |
|---|---|
| `origin_type` | Still `generated_by_tool` — historically accurate |
| `generated_by_connection_id` | Preserved for provenance and attribution |
| Prior note versions | Untouched — immutable |
| Guide note status | Unchanged — promotion does not affect guide assignment |

### Why promotion creates a new version

Making promotion a new version (not a silent metadata update) keeps the state transition legible in the History tab. Users and auditors can see exactly when a generated note was promoted and by whom. This is consistent with how rollback works.

---

## Audit events

| Event | Actor type | Triggered by |
|---|---|---|
| `write_proposal.created` | `connection` | Proposal creation |
| `write_proposal.approved` | `user` | Owner approves |
| `write_proposal.rejected` | `user` | Owner rejects |
| `write_proposal.conflicted` | `user` | Conflict detected at approval time |
| `folder.generated_policy_changed` | `user` | Owner toggles folder policy |
| `note.generated` | `connection` | Direct generated note creation |
| `note.promoted_from_generated` | `user` | Owner promotes generated note |

---

## Human review UI

Route: `/app/proposals`

- Lists all proposals for the workspace
- Filterable by status
- Each card shows:
  - Proposal type and status
  - Connection name
  - Proposed title
  - Rationale
  - Created date
  - Current note content (for update/append/replace)
  - Preview of proposed result (expandable)
  - `replace_note` proposals show an explicit warning
  - Conflicted proposals show a clear stale notice
- Approve and Reject buttons with optional review comment

---

## What is NOT available in V1

- External approval/rejection through the API or MCP (humans only)
- External proposal cancellation
- Rollback of approved changes
- Version history browsing
- Expiry enforcement (expires_at field exists but is not actively polled)
- Cross-box proposals
- Folder creation through proposals

---

## Files

| Layer | File | Purpose |
|---|---|---|
| Migration | `supabase/migrations/20260409000005_machine_write_rpc.sql` | `proposed_summary`, `proposed_tags` columns; 3 atomic SQL functions |
| Domain type | `src/server/domain/types/write_proposal.ts` | `proposed_summary`, `proposed_tags` added |
| Repository | `src/server/repositories/write_proposal_repository.ts` | `listWriteProposalsByConnection` added |
| Service | `src/server/services/write_proposal_service.ts` | Create, list, approve, reject, preview |
| Service | `src/server/services/generated_note_service.ts` | Direct generated note creation; `promoteGeneratedNote` |
| Service | `src/server/services/folder_service.ts` | `setGeneratedFolderPolicy` added |
| Service | `src/server/services/audit_service.ts` | `writeConnection` helper + 6 new audit functions |
| API route | `src/app/api/v1/write_proposals/route.ts` | `POST` + `GET` |
| API route | `src/app/api/v1/generated_notes/route.ts` | `POST` |
| MCP client | `src/server/mcp/client/canonical_api_client.ts` | `createWriteProposal`, `listWriteProposals`, `createGeneratedNote` |
| MCP tools | `src/server/mcp/tools/write_proposals.ts` | 3 write tools |
| App actions | `src/app/app/proposals/actions.ts` | `approveProposalAction`, `rejectProposalAction`, `setFolderGeneratedPolicyAction` |
| App actions | `src/app/app/notes/[note_id]/actions.ts` | `promoteGeneratedNoteAction` |
| Component | `src/components/product/generated_note_banner.tsx` | Generated note banner with promote action |
| Migration | `supabase/migrations/20260409000011_generated_note_promotion.sql` | `change_origin='promotion'` constraint; `promote_generated_note` RPC |
| App page | `src/app/app/proposals/page.tsx` | Proposals review page |
| Component | `src/components/product/proposals_panel.tsx` | Proposal cards with approve/reject |
| Component | `src/components/product/folder_policy_toggle.tsx` | Folder policy toggle |
| Box view | `src/app/app/boxes/[box_id]/page.tsx` | Folder policies section in right panel |
| Sidebar | `src/components/product/app_sidebar.tsx` | Proposals nav link added |
