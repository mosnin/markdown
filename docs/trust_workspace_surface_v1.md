# Trust workspace surface — V1

This document describes the trust, reversibility, and machine workflow surfaces:
proposal review, version history, audit browsing, connections, and generated note
provenance. Later prompts must preserve the rules described here.

---

## Purpose

Context Store is a trust environment — not just a notes app. Every machine write
is tracked, reversible, and human-reviewable. The surfaces described here make
that trust architecture visible to humans without alarm.

The product should feel like:
- Machine writes are inspectable and controlled, not invisible
- Version history is an immutable audit chain, not a backup system
- Proposals are a lightweight review queue, not a notification center
- Connections are access control records, not plugin management
- Generated notes are clearly marked until promoted

---

## Proposal review surface

### What it is

Write proposals are connection-submitted note changes pending human review.
The review surface (`ProposalsPanel`) should feel like a lightweight PR review queue.

### Proposal types and their visual treatment

| Type | Icon | Visual treatment |
|---|---|---|
| `create_note` | FilePlus | Standard muted badge |
| `update_note` | PenLine | Standard muted badge |
| `append_note` | ArrowDownToLine | Standard muted badge |
| `replace_note` | RefreshCcw | **Destructive** badge (red) + card border |

**Replace proposals** always get:
- `bg-destructive/10 text-destructive` TypeBadge
- `border-destructive/30` on the card itself when pending
- An explicit warning callout: "This is a full replacement. Approving will overwrite…"

**Conflicted proposals** always get:
- `border-destructive/40 bg-destructive/5` card styling
- A conflict notice explaining the note was modified after submission

### Content preview — type-aware

The content preview section (`ProposalContentPreview`) is type-aware:

| Type | What is shown |
|---|---|
| `create_note` | "New note content" only |
| `append_note` | Current note (muted) → visual separator "↓ appending below" → new portion being appended (primary/40 left border) |
| `replace_note` | Current content (muted, labeled "will be replaced") → replacement content (destructive/50 left border) |
| `update_note` | Current content (muted) → proposed content |

**Critical rule**: for `append_note`, show `proposal.proposed_content` (the new portion),
NOT `preview_content` (the full merged result). The separator makes the operation self-evident.

### Status vocabulary

| Status | Visual |
|---|---|
| `pending` | Warning pill |
| `approved` | Success pill |
| `rejected` | Muted pill |
| `conflicted` | Destructive pill |
| `canceled` | Muted pill |
| `expired` | Muted pill |

### Review action

Approve/Reject buttons are always present for pending proposals. A collapsible
"Add comment" form adds an optional `review_note`. The review note is shown
inline after approval/rejection: "Reviewed [date] — [comment]".

---

## Version history surface

### What it is

The `NoteHistoryPanel` is an immutable version timeline — every write creates a
new version; nothing is deleted. It is a trust surface, not a backup UI.

### Two-pane layout

Left pane (version list): version cards ordered newest-first, each showing:
- Change origin icon + label
- Version number + origin label + date
- Diff badges (title / body / summary / tags, +N bytes / -N bytes)

Right pane (version detail): full metadata, diff summary, content snapshot,
and rollback action.

### Change origin visual treatment

| Origin | Icon | Label |
|---|---|---|
| `human_edit` | User | Human edit |
| `import` | FileInput | Import |
| `generated` | Bot | Generated |
| `proposal_approved` | CheckCircle2 | Proposal approved |
| `rollback` | RotateCcw | Rollback |
| `promotion` | ArrowUpFromLine | Promoted |

### Actor type labels

Raw `actor_type` values are never shown directly. Always map:
- `user` → "Human"
- `connection` → "Connection"
- `system` → "System"

### Rollback flow

Rollback is a deliberate action — it creates a new version (not destructive).
The confirm step shows an amber warning: "This will create a new version with
the content of vN. The current version and all history are preserved."

The confirm button reads "Confirm restore" — not "Rollback" or "Revert".

---

## Audit workspace surface

### What it is

The `AuditPanel` is an append-only activity journal. Every meaningful workspace
event is recorded. It shows who did what, when.

### Event type labels

Event types are shown as human-readable labels, not raw dot-separated strings.

Known event type labels:
- `note.created` → "Note created"
- `note.updated` → "Note updated"
- `note.archived` → "Note archived"
- `note.rolled_back` → "Note rolled back"
- `note.promoted` → "Note promoted"
- `write_proposal.submitted` → "Proposal submitted"
- `write_proposal.approved` → "Proposal approved"
- `write_proposal.rejected` → "Proposal rejected"
- `write_proposal.conflicted` → "Proposal conflicted"
- `connection.created` → "Connection created"
- `connection.revoked` → "Connection revoked"
- `note_link.created` → "Link created"
- (unknown events): fall back to `event_type.replace(/[._]/g, " ")`

### Actor type display

`actor_type` is always shown as a human label:
- `user` → "Human"
- `connection` → "Connection"
- `system` → "System"

The filter option for connection-originated events uses value `"connection"`,
NOT `"agent"` — `"agent"` is not a valid `ActorType` value.

### Actor icon

- `user` → User icon
- `connection` or `system` → Bot icon

### Metadata expansion

Events with non-empty `metadata` are expandable. The JSON dump is always in a
pre/code block, never rendered inline. Collapsed by default.

---

## Connections and permission visibility

### What it is

The `ConnectionsPanel` is an access control surface — not plugin management.
It shows who has access, with what permissions, to which boxes.

### Connection card — always visible

Each connection card always shows:
- Name + Type badge (MCP / API Token / Internal)
- Permission mode badge (Read only / Propose writes / Generate in allowed folders)
- Status badge — only shown when status ≠ `active` (shows "Paused" or "Revoked")
- Last used date + box count

### Connection card — expanded

The expanded detail shows:
- Usage count ("Never used" or "N requests")
- Status (always shown in expanded view with color: success/warning/destructive)
- Box access: chips listing scoped boxes, or "No boxes — this connection has no data access."
- Rotate token + Revoke actions

### Status colors

| Status | Color treatment |
|---|---|
| `active` | No badge on header (normal state) — shown as text in detail |
| `paused` | Warning badge on header (`text-warning border-warning/30 bg-warning/10`) |
| `revoked` | Destructive badge on header |

### Permission mode labels and descriptions

| Mode | Label | Description |
|---|---|---|
| `read_only` | "Read only" | May only read notes, folders, and metadata. |
| `propose_writes` | "Propose writes" | May submit write proposals for human review. Cannot write directly. |
| `generate_in_allowed_folders` | "Generate in allowed folders" | May write directly to folders where accepts_generated_notes = true. |

### Token security

Tokens are shown exactly once — on creation and on rotation. The reveal dialog
uses amber styling (cannot be recovered warning). Secrets are stored as hashes
only. The format is `csk_v1_...`.

---

## Generated note provenance

### When a note is generated

When `note.is_generated` is true, three signals appear:
1. **Top bar badge** — "Generated" (Bot icon, outline style)
2. **GeneratedNoteBanner** — between top bar and editor; names the connection;
   offers "Promote to standard note" with confirm flow
3. **Info tab — Machine origin section** — "Generated by [connection name]";
   shown only when `is_generated` is true

### Promotion flow

Promotion is deliberate:
1. User clicks "Promote to standard note"
2. Confirm step: "This will mark the note as user-managed. A new version will be
   recorded. All prior history and attribution remain unchanged."
3. After promotion: `is_generated` becomes false; all three signals disappear;
   `origin_type` remains `generated_by_tool`; history tab shows the promotion version

### What promotion does NOT do

- Does NOT erase provenance (origin_type is preserved)
- Does NOT remove the connection attribution from version history
- Cannot be done by a connection — human-only action

---

## Heterogeneous proposal review (Phase 3)

The proposals page (`/app/proposals`) now handles proposals for all four object types:

- Note proposals use the existing `ProposalCard` (unchanged)
- File/Skill/Agent proposals use `HeterogeneousProposalCard`
- The `ProposalsPanel` dispatches on `proposal.target_object_type` — non-null means object proposal

`HeterogeneousProposalCard` shows:
- `ProposalTargetSummary` — action label, type icon, target name, format badge, reusable badge
- Connection name attribution
- Rationale section
- Conflict notice (for `conflicted` status)
- Reusable impact notice — "This targets a workspace-shared [type]. Approving will affect all boxes that reference it."
- Current source vs proposed source (raw content, no fake structured diffs)
- Approve/Reject with optional review note

## Object trust surfaces (Phase 3)

New components on object detail pages:

- **Skill page** (`/app/skills/[skill_id]/page.tsx`) — `ObjectTrustHeader`, `MachineProvenancePanel`, `SkillHistoryPanel`, `SkillLifecycleControls`
- **Agent page** (`/app/agents/[agent_id]/page.tsx`) — `ObjectTrustHeader`, `MachineProvenancePanel`, Trust tab with `AgentHistoryPanel` and `AgentLifecycleControls`

`MachineProvenancePanel` renders only when `origin_type` is `generated` or `imported`, or when there are pending proposals targeting the object. It does not render for user-created objects with no pending proposals.

`ObjectTrustHeader` renders an inline summary: object type badge, workspace-shared badge (if reusable), lifecycle status, pending proposal count, and generated origin hint.

---

## Rules for future prompts

1. **Append previews show the new portion, not the merged result** — use
   `proposal.proposed_content` for append; `preview_content` is the merged result.
2. **Replace proposals always get destructive styling** — card border + TypeBadge
   + explicit replace warning when pending.
3. **Conflicted proposals are never actionable** — show the conflict notice; never
   show Approve/Reject for conflicted proposals.
4. **Actor type raw values are never shown** — always map to "Human" / "Connection" /
   "System". This applies to audit events, version history, and any future surface.
5. **Audit actor filter uses `"connection"`, not `"agent"`** — `"agent"` is not a
   valid ActorType.
6. **Event type labels are human-readable** — use the EVENT_LABEL map; never show
   raw dot-separated strings in the UI.
7. **Connection status badge appears only when non-active** — active is the normal
   state; showing an "Active" badge everywhere creates noise.
8. **Rollback creates a new version — the confirm copy must say so** — never say
   "this will overwrite" or "this is destructive".
9. **Promotion is human-only and deliberate** — always require a confirm step.
10. **Machine origin section shows only when `is_generated`** — not for all notes.
11. **Reusable shared objects always show the reusable impact notice when pending** — the notice must explain that approval affects all attached boxes.
12. **`MachineProvenancePanel` accepts a `className` prop** — use `rounded-none border-x-0 border-t-0` when rendering as a flush section between bordered header areas.
