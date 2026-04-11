# Reusable Attach and Reference Model

This document specifies how workspace-level reusable Skills and Agents are attached into boxes by reference, how those references are surfaced in the UI, and how detach works safely.

---

## Core concept

A **reusable** skill or agent (`is_reusable = true`) lives in the workspace library (`box_id = null`). It is a single canonical object. Boxes can hold a **reference** to a reusable object via `box_object_attachments`. There is no copy — the reusable source is shared.

Consequences:
- Editing a reusable object's source affects every box where it is referenced.
- Detaching a reference from a box removes only the pointer. The source object is unaffected.
- Attaching the same object to multiple boxes is valid and expected.

---

## Database: `box_object_attachments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | |
| `box_id` | uuid FK | The box that holds the reference |
| `folder_id` | uuid FK nullable | Folder placement within the box tree |
| `object_type` | text | `'skill'` or `'agent'` only |
| `object_id` | uuid | FK to skills or agents |
| `sort_order` | int | Visual ordering |
| `attached_by` | uuid nullable | User who created the attachment |
| `attached_at` | timestamptz | |

Unique constraint: `(box_id, object_type, object_id)` — a given object can only be attached to a given box once.

No UPDATE: to reposition (change folder_id), delete and re-insert.

---

## Attach/detach server actions

All actions live in `src/app/app/boxes/actions.ts`.

### `attachSkillToBoxAction(boxId, skillId, folderId?)`

- Validates: box exists + belongs to workspace, skill exists + belongs to workspace + `is_reusable = true` + not trashed
- Idempotent: if already attached, returns the existing attachment id
- Creates a `box_object_attachments` row with `object_type = 'skill'`
- Calls `revalidatePath('/app/boxes/[boxId]')`

### `attachAgentToBoxAction(boxId, agentId, folderId?)`

- Same validation as above, for agents
- Idempotent on duplicate attach

### `detachFromBoxAction(boxId, objectType, objectId)`

- Validates: box exists + belongs to workspace
- Calls `deleteAttachmentForObject` — no-ops silently if the attachment does not exist
- Does NOT modify the source object or its attachments in other boxes
- Calls `revalidatePath('/app/boxes/[boxId]')`

### `getAttachablesToBoxAction(boxId)`

- Returns reusable skills and agents **not already attached** to the box
- Used by `AttachReusableDialog` to populate the browse list
- Excluded: objects already attached, trashed objects

---

## Tree sidebar: attach and detach surface

### "Attach reusable…" in BoxQuickCreateMenu

A new "Attach reusable…" item in the box quick-create dropdown opens `AttachReusableDialog`.

`AttachReusableDialog`:
- Two tabs: Skills | Agents
- Loads unattached reusable objects via `getAttachablesToBoxAction(boxId)`
- Single-select; click to toggle selection
- "Attach" button calls `attachSkillToBoxAction` or `attachAgentToBoxAction`
- On success: closes dialog, calls `onAttached()` → `onTreeRefresh()` → re-fetches tree

### Attached rows in the tree

- Attached reusable skills/agents display with a `↗` marker (same as before)
- **Archived** attached objects are shown with reduced opacity (`opacity-50`)
- **Trashed** attached objects are excluded from the tree return value in `getBoxTreeAction`

### Hover detach button

When the user hovers over an attached row (`is_attachment = true`), a detach button (trash icon) appears on the right side. Clicking it:
1. Calls `detachFromBoxAction(boxId, objectType, objectId)` via `useTransition`
2. On success, calls `onDetached()` → `onTreeRefresh()` → re-fetches tree
3. The source object is not affected

### Link href for attached reusables

Attached skill/agent rows link with a `?box_id=xxx` query param:
- Skill: `/app/skills/[id]?box_id=[boxId]`
- Agent: `/app/agents/[id]?box_id=[boxId]`

This allows the destination page to show the reference context banner.

### Realtime

`box_object_attachments` is now subscribed in the realtime channel:
```javascript
.on("postgres_changes", { event: "*", schema: "public", table: "box_object_attachments", filter: `workspace_id=eq.${workspaceId}` }, makeHandler)
```

The `makeHandler` extracts `box_id` from the payload and schedules a debounced tree refetch for that box.

---

## Reference context banner

`ReferenceContextBanner` is shown when a reusable skill or agent is opened from a box context (i.e., `?box_id=xxx` is present and verified).

The banner:
- Identifies the box the user navigated from
- States that edits affect all boxes where this object is attached
- Provides a "Detach from [box]" action with inline confirm
- On detach success: navigates to `/app/boxes/[boxId]`

### Verification

Before showing the banner, the page verifies:
1. The `box_id` param is a real box in the same workspace
2. An attachment record actually exists for this object in that box

If verification fails, the banner is not shown (no leakage of box existence to unauthorized users).

---

## Object pages: reference context

### `src/app/app/agents/[agent_id]/page.tsx`

Reads `?box_id` searchParam. If verified:
- Sets `refBox = { id, name }` of the context box
- Shows `ReferenceContextBanner` between the agent header and the tabs
- Adjusts breadcrumb: `workspace → [boxName] → [agentName]` instead of `workspace → Agents → [agentName]`

### `src/app/app/skills/[skill_id]/page.tsx`

Same pattern: reads `?box_id`, verifies, shows `ReferenceContextBanner` if valid.

---

## Library pages: attach from source

Both `src/app/app/agents/page.tsx` and `src/app/app/skills/page.tsx` show an "Attach to box" button on each card.

### `AttachToBoxTrigger`

Client component rendered inside each library card. Manages dialog open state. Spawns `AttachToBoxDialog` when clicked.

### `AttachToBoxDialog`

Shows the workspace's boxes as a pick list. User selects one box, then clicks "Attach". Calls `attachSkillToBoxAction` or `attachAgentToBoxAction`. On success: `router.refresh()` to reflect any updated attachment counts.

This is the inverse of `AttachReusableDialog` (which starts from a box and picks an object).

---

## `getBoxTreeAction` changes

- Skills and agents in the return type now include `status: string`
- Local skills/agents: fetched with `includeArchived: true` so archived items appear in tree with reduced opacity
- Attached skills/agents: trashed ones are excluded after bulk-fetch (filtered in the action, not the repository)
- Attached archived objects are kept (shown dimmed)

---

## Components

| Component | File | Purpose |
|---|---|---|
| `AttachReusableDialog` | `attach_reusable_dialog.tsx` | From box context: browse + attach reusable objects |
| `AttachToBoxDialog` | `attach_to_box_dialog.tsx` | From library context: pick a box and attach |
| `AttachToBoxTrigger` | `attach_to_box_trigger.tsx` | Client wrapper that opens `AttachToBoxDialog` |
| `ReferenceContextBanner` | `reference_context_banner.tsx` | Banner shown when viewing reusable in box context |

---

## Trust model

- Only `is_reusable = true` objects can be attached.
- Attach/detach are workspace-scoped: both the box and the object must belong to the same workspace.
- Reusable object edits still go through the source object's editor. The reference model does not create a copy or a separate editing surface.
- The detach action removes only the `box_object_attachments` row. It never touches the source object.

---

## Known limitations and follow-ons

1. **No folder picker in the attach dialogs.** The current attach flow always attaches at the box root (`folder_id = null`). A folder picker can be added as a follow-on.
2. **No reposition UI.** Moving an attached object to a different folder requires detach + re-attach. A drag-to-folder action is a future improvement.
3. **No attachment count on library cards.** The library pages show an "Attach to box" button but do not display how many boxes the object is currently attached to. A count badge is a follow-on.
4. **"Attach to box" does not exclude already-attached boxes.** The `AttachToBoxDialog` lists all boxes. If the object is already in the selected box, the action is idempotent. A visual indicator for already-attached boxes would improve UX.
