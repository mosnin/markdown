# Expanded Object Trust Model — V1

This document describes the trust, permissions, versioning, lifecycle, and machine workflow model extended across all four first-class Context Store object types: **Notes, Files, Skills, and Agents**.

Phase 3 of the trust architecture generalizes the note-centric V1 model so that Files, Skills, and Agents receive the same rigorous human oversight guarantees.

---

## The four object types

| Object type | Version table | Reusable? | Proposal-only external writes? |
|---|---|---|---|
| `note` | `note_versions` | No (box-local) | All updates require proposal |
| `file` | `object_versions` | No (box-local) | Update proposals only |
| `skill` | `object_versions` | Yes (optional) | Reusable: always; box-local: proposal path available |
| `agent` | `object_versions` | Yes (optional) | Reusable: always; box-local: proposal path available |

Notes remain unchanged. The three new object types use a shared `object_versions` table rather than a dedicated per-type table.

---

## Trust levels

### `box_local`

The object lives inside a specific box. Ownership is checked via two-hop traversal: `object → box_id → workspace_id`. External connections must have scope for that box.

### `workspace_reusable`

The object is attached to the workspace directly (`box_id IS NULL`, `is_reusable = TRUE`). Ownership is checked directly via `workspace_id`. Reusable objects can be attached to many boxes simultaneously.

**Critical rule:** External connections can never directly mutate a reusable shared object. All external writes must go through the proposal system. The human owner who performs a rollback is the one deliberate exception — rollback to a known-good state is always human-authorized and audited.

---

## Object trust policy

The `object_trust_policy_service.ts` module exposes:

```typescript
getObjectTrustPolicy(supabase, objectType, objectId): Promise<ObjectTrustPolicy | null>
connectionCanDirectlyWrite(permissionMode, policy): boolean
describeObjectTrustLevel(policy): { label: string; detail: string }
```

`connectionCanDirectlyWrite` returns `false` for any reusable shared object regardless of the connection's permission mode. This is enforced in `write_proposal_service.ts` before any write operation.

---

## Proposal types — extended

The `write_proposals` table accepts five new `proposal_type` values:

| Type | Target | Description |
|---|---|---|
| `update_file` | `target_object_id` (file) | Propose replacing a file's source content |
| `create_skill` | `target_folder_id` or workspace | Propose creating a new skill |
| `update_skill` | `target_object_id` (skill) | Propose replacing a skill's source content |
| `create_agent` | `target_folder_id` or workspace | Propose creating a new agent |
| `update_agent` | `target_object_id` (agent) | Propose replacing an agent's source content |

Note proposals (`create_note`, `update_note`, `append_note`, `replace_note`) are unchanged.

### Routing

The proposal service uses constant sets to route cleanly:

```typescript
NOTE_PROPOSAL_TYPES   = Set(['create_note', 'update_note', 'append_note', 'replace_note'])
OBJECT_PROPOSAL_TYPES = Set(['update_file', 'create_skill', 'update_skill', 'create_agent', 'update_agent'])
```

---

## Conflict detection — extended

For object proposals, `target_object_version_id` captures the `current_version_id` at proposal creation time. When a human approves, the `approve_write_proposal_object_update` SQL RPC checks that `current_version_id` still matches. If not, the proposal status transitions to `conflicted` and no write is performed.

This mirrors the existing note conflict detection model exactly.

---

## Versioning — shared object_versions table

Files, Skills, and Agents use a shared `object_versions` table:

| Column | Description |
|---|---|
| `id` | Stable UUID |
| `object_type` | `file`, `skill`, or `agent` |
| `object_id` | UUID of the owning object |
| `version_number` | Monotonically increasing within an object, starting at 1 |
| `source_content` | Full snapshot of source content at this version |
| `content_bytes` | `octet_length(source_content)` |
| `actor_type` | `user`, `connection`, or `system` |
| `actor_id` | UUID of the actor |
| `change_origin` | How this version came to exist — see below |
| `diff_summary` | Lightweight jsonb description of what changed |
| `created_at` | Immutable write time |

### change_origin values

| Value | Meaning |
|---|---|
| `human_edit` | Human edited via the product UI |
| `import` | Created by the import service |
| `generated` | Created directly by a `generate_in_allowed_folders` connection |
| `proposal_approved` | Human approved a write proposal |
| `rollback` | Human rolled back to a prior version |

### Immutability rule

`object_versions` rows are **INSERT-only**. No update or delete is permitted. Rollback creates a new row with `change_origin = 'rollback'` — it never rewrites history.

---

## Rollback

Human owners can roll back a skill or agent to any prior version. Rollback:
1. Reads the target version snapshot
2. Inserts a new `object_versions` row with `change_origin = 'rollback'` and `actor_type = 'user'`
3. Updates `current_version_id` on the owning row

This is the one deliberate exception to the "reusable objects require proposals" rule. The human owner is explicitly restoring to a known-good state, and the action is fully audited.

Server action: `rollbackSkillAction`, `rollbackAgentAction`, `rollbackFileAction` — all in their respective `lifecycle_actions.ts` files.

---

## Lifecycle — extended to files, skills, agents

All three new object types support `draft → active → archived → trashed` lifecycle state transitions matching the existing note model.

### Key behavior: reusable objects and attachments

When a reusable shared skill or agent is **archived** or **trashed**, `box_object_attachments` rows are **intentionally left intact**. Attached boxes continue to reference the object, and the UI shows a `ReusableObjectDegradedBadge`. This is an explicit design decision — silent detach would surprise users.

To fully remove a reusable object from all boxes, the human owner must explicitly detach it from each box before trashing.

### Lifecycle server actions

| Object | Actions file |
|---|---|
| File | `src/app/app/files/lifecycle_actions.ts` |
| Skill | `src/app/app/skills/lifecycle_actions.ts` |
| Agent | `src/app/app/agents/lifecycle_actions.ts` |

---

## Audit events — extended

All trust-sensitive actions on files, skills, and agents are recorded in `audit_events`:

| Event | When |
|---|---|
| `file.archived`, `skill.archived`, `agent.archived` | Lifecycle transition |
| `file.unarchived`, `skill.unarchived`, `agent.unarchived` | Lifecycle transition |
| `file.trashed`, `skill.trashed`, `agent.trashed` | Lifecycle transition |
| `file.restored`, `skill.restored`, `agent.restored` | Lifecycle transition |
| `file.created`, `skill.created`, `agent.created` | Object creation |
| `file.updated`, `skill.updated`, `agent.updated` | Object content update |
| `file.exported`, `skill.exported`, `agent.exported` | Export performed |
| `file.imported`, `skill.imported`, `agent.imported` | Import performed |
| `skill.rollback`, `agent.rollback`, `file.rollback` | Version rollback |
| `skill.reusable_attached`, `agent.reusable_attached` | Reusable object attached to a box |
| `skill.reusable_detached`, `agent.reusable_detached` | Reusable object detached from a box |
| `write_proposal.object_approved` | Object proposal approved |
| `write_proposal.object_rejected` | Object proposal rejected |

Audit events are **append-only** and **fire-and-forget** — they never block the primary operation.

---

## Trust UI components

Ten new components implement the trust surface:

| Component | Purpose |
|---|---|
| `SharedObjectTrustBadge` | Compact badge: "Workspace shared · External writes require a proposal" |
| `ObjectTrustHeader` | Combined trust header: type icon, name, format, lifecycle status, proposals count |
| `ObjectLifecyclePanel` | Archive/Unarchive/Trash/Restore with confirmation step for destructive actions |
| `HeterogeneousVersionTimeline` | Version list with rollback button (confirmation required) |
| `ObjectHistoryPanel` | Collapsible wrapper around `HeterogeneousVersionTimeline` |
| `ProposalTargetSummary` | Compact proposal header: action label, type icon, target name, format, reusable badge |
| `SharedReferenceImpactNotice` | Warning when archiving/trashing a reusable object with attachments |
| `ConnectionPermissionHint` | Shows connection permission mode + extra hint for reusable object targeting |
| `MachineProvenancePanel` | Shown only when `origin_type` is generated/imported or there are pending proposals |
| `HeterogeneousProposalCard` | Full proposal review card working for all four object types |

### Client wrapper pattern

Server action functions cannot be passed as arbitrary JSX props from Server Components to Client Components. Thin client wrappers are used instead:

- `skill_trust_panels.tsx` — `SkillHistoryPanel`, `SkillLifecycleControls`
- `agent_trust_panels.tsx` — `AgentHistoryPanel`, `AgentLifecycleControls`

These components import and call the server actions internally, avoiding inline closure serialization issues.

---

## Invariants preserved

The following invariants from Phase 1–2 are **not changed** by Phase 3:

- `note_versions` rows are separate from `object_versions` — notes are unaffected
- `audit_events` remains append-only and fire-and-forget
- Rollback is always human-controlled (never machine-triggered)
- `middleware.ts` only refreshes the Supabase JWT cookie — no business logic
- Stable IDs are canonical identity for all object types
- Markdown is canonical format for notes; `canonical_format` governs files/skills/agents
- Guide note protections are unchanged
- `generate_in_allowed_folders` applies to note creation only; reusable shared objects always require proposals for external writes
