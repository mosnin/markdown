# Inline Slash Commands v1

This document describes the inline slash-command feature that lets users
invoke AI operations from within the note editor. Source of truth:

- `src/server/domain/types/inline_command.ts`
- `src/app/app/notes/inline_command_actions.ts`
- `src/components/product/slash_command_menu.tsx`
- `src/components/product/note_crdt_editor.tsx`
- `supabase/migrations/20260426000001_streaming_and_inline_ai.sql`

## 1. Overview

While typing in the CRDT-backed note editor, a user may press `/` to open
a floating command menu listing built-in commands (`Summarize`, `Expand`,
`Translate…`, `Add citations`, `Outline`, `Rewrite`) plus any workspace
skill whose `is_subagent` flag is `true`. Selecting a command captures a
window of surrounding note text as `context`, removes the typed `/query`
trigger from the buffer, calls `runInlineCommandAction` (which creates
an `inline_command_invocations` row and dispatches a sub-agent run to
Modal), polls `getInlineCommandStatusAction` until a terminal status
(`completed | failed | cancelled`) or a 90s deadline, then inserts the
model output at the original trigger position. A `Running…` badge is
shown at the bottom-right of the editor while the invocation is in
flight.

## 2. Menu Trigger Rules

The menu is driven by `syncSlashMenuFromEditor` in
`note_crdt_editor.tsx` (called from the CodeMirror `updateListener` on
every `docChanged` or `selectionSet` update). Trigger logic:

- Start at the caret (`sel.head`) and scan backwards up to **32
  characters**:

  ```ts
  const MAX_SCAN = 32;
  while (scan > 0 && caretPos - scan < MAX_SCAN) {
    const ch = doc.sliceString(scan - 1, scan);
    if (ch === "/") { ... break; }
    if (/\s/.test(ch)) break;
    scan--;
  }
  ```

- The `/` only counts as a trigger when it is either at column 0 or
  immediately preceded by whitespace:

  ```ts
  const col = scan - 1 - doc.lineAt(scan - 1).from;
  const prev = scan - 1 > 0 ? doc.sliceString(scan - 2, scan - 1) : "";
  if (col === 0 || /\s/.test(prev)) {
    slashPos = scan - 1;
  }
  ```

- The text between `/` and the caret is treated as the menu filter
  `query`. It must match `/^[a-z0-9_-]*$/i`; any other character (space,
  punctuation, etc.) closes the menu:

  ```ts
  const query = doc.sliceString(slashPos + 1, caretPos);
  if (!/^[a-z0-9_-]*$/i.test(query)) {
    setSlashMenu(null);
    return;
  }
  ```

- The menu anchor is placed at `view.coordsAtPos(slashPos)` with
  `top = coords.bottom + 4`, `left = coords.left`.

## 3. Command Sources

### 3.1 Built-in Commands

Declared in `src/server/domain/types/inline_command.ts` as the
`BuiltInCommandId` union:

```ts
export type BuiltInCommandId =
  | "summarize"
  | "expand"
  | "translate"
  | "cite"
  | "outline"
  | "rewrite";
```

Each member has a `label`, `description`, `hint`, and `system_prompt`
captured in the `BUILT_IN_COMMANDS` array. The `system_prompt` is applied
server-side via `systemPromptOverride` on `dispatchSubagentRun` — the
Modal runtime resolves it in its `inline_command` namespace.

### 3.2 Skill Commands

Any workspace skill with `is_subagent = true` is offered in the same
menu. Skills are surfaced by `listSkillsForSlashMenuAction`, which
queries `skills` filtered to the current workspace and
`is_subagent = true`, ordered by `updated_at DESC` and capped at `20`
rows. Skill entries appear with `commandId = "skill:<uuid>"` — the
`skill:` prefix distinguishes them from built-ins.

The editor lazy-fetches skills the first time the slash menu opens
(`hasFetchedSkillsRef` in `note_crdt_editor.tsx`).

## 4. Server Actions

All actions live in `src/app/app/notes/inline_command_actions.ts` and
are `"use server"` exports. Every action calls
`requireAuthenticatedUser()` and verifies the workspace match.

### 4.1 `runInlineCommandAction`

**Input:** `{ noteId, commandId, context, selectionStart?, selectionEnd?, argument? }`.
`commandId` is a built-in id or `"skill:<uuid>"`; `argument` carries the
translate target language.

**Return:** `{ ok: true; invocation_id; subagent_invocation_id } | { ok: false; error }`.

**Auth + rate limit:**

- Requires authenticated user.
- Rate limited via `checkRateLimit("inline_command:<user_id>", 30, 60)`
  — `INLINE_COMMAND_RATE_LIMIT_PER_MIN = 30` requests per 60s window.
- Verifies `box.workspace_id === ctx.workspace.id` for the note.

**Flow:**

1. For `skill:<uuid>`: looks up the skill, rejects unless it is in the
   current workspace AND `is_subagent = true`. Creates a
   `subagent_invocations` row via `createSubagentInvocation`, then calls
   `dispatchSubagentRun` with the resolved `skill_id`. Writes
   `subagent_invocation_id` and `modal_run_id` back.
2. For a built-in: looks up `BUILT_IN_COMMANDS`, rejects unknown ids,
   then dispatches with `skillId: null` and the built-in's
   `system_prompt` as `systemPromptOverride`. No `subagent_invocations`
   row is created.
3. If dispatch throws, the invocation is marked `status = "failed"`
   with the error message and `completed_at = now()`.

### 4.2 `getInlineCommandStatusAction`

**Input:** `invocationId: string`.

**Return:**

```ts
{ ok: true; status: "running"|"completed"|"failed"|"cancelled"; output; error }
| { ok: false; error }
```

Requires auth and workspace match on the loaded row. Read-only. No rate
limit.

### 4.3 `cancelInlineCommandAction`

**Input:** `invocationId: string`. **Return:** `{ ok: true } | { ok: false; error }`.

Requires auth and workspace match. Sets `status = "cancelled"` and
`completed_at = now()` on the invocation, and mirrors the cancellation
onto the linked `subagent_invocations` row if present. If the row is
not currently `running`, the action is a no-op that returns `{ ok: true }`.

### 4.4 `listSkillsForSlashMenuAction`

**Input:** none. **Return:** `{ ok: true; data: { id; name; description }[] } | { ok: false; error }`. Returns up to 20 skill sub-agents for the
current workspace, sorted by `updated_at DESC`.

## 5. Context Window

When the user picks a command, `dispatchCommand` captures a text window
around the trigger position. The numbers are exact:

```ts
const triggerPos = slashMenu.triggerPos;
const caretPos = view.state.selection.main.head;
const docText = view.state.doc.toString();
const selStart = Math.max(0, triggerPos - 800);
const selEnd = Math.min(docText.length, caretPos + 200);
const context = docText.slice(selStart, selEnd);
```

That is: **800 characters back** from the `/` and **200 characters
forward** from the caret. The resulting slice is passed as the
`context` field of `runInlineCommandAction`. The server composes the
task string as:

```ts
const argSuffix = input.argument ? `\n\nTarget: ${input.argument}` : "";
const taskPrefix = systemPrompt
  ? `[Inline command "${input.commandId}"] ${systemPrompt}\n\n`
  : "";
const task = `${taskPrefix}Context:\n\n${input.context}${argSuffix}`;
```

For built-ins the client-captured `selectionStart` / `selectionEnd` are
also stored on the invocation row so completions can be correlated
against the edit history.

## 6. Polling Loop

`dispatchCommand` polls until a terminal status is reached:

```ts
const deadline = Date.now() + 90_000;
let output: string | null = null;
while (mountedRef.current && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  if (!mountedRef.current) return;
  const status = await getInlineCommandStatusAction(res.invocation_id);
  if (!status.ok) break;
  if (status.status === "completed") {
    output = status.output;
    break;
  }
  if (status.status === "failed" || status.status === "cancelled") break;
}
```

Key numbers:

- **Deadline:** `Date.now() + 90_000` (90 seconds).
- **Poll interval:** `setTimeout(r, 1000)` (1 second).
- **Unmount guard:** `mountedRef` is `true` while the editor is mounted.
  It is re-checked both at the top of each iteration and immediately
  after the `setTimeout` await, so a navigation that happens mid-poll
  short-circuits the loop. A final `if (!mountedRef.current) return;`
  precedes the insertion step so no CodeMirror transaction is dispatched
  onto a stale view.
- **Terminal statuses:** `completed | failed | cancelled`. Only
  `completed` carries `output`; the others simply exit the loop.

On success, the output is inserted at the original `triggerPos`:

```ts
currentView.dispatch({
  changes: { from: triggerPos, to: triggerPos, insert: output },
  selection: { anchor: triggerPos + output.length },
});
```

## 7. Failure Restore

Before calling the server, `dispatchCommand` snapshots the typed
trigger text (`triggerText = view.state.doc.sliceString(triggerPos, caretPos)`)
and clears it from the editor with a single dispatch (`changes: { from: triggerPos, to: caretPos, insert: "" }`).

If `res.ok === false`, the original `/query` text is re-inserted at
`triggerPos` so the user does not lose their typing:

```ts
if (!res.ok) {
  if (mountedRef.current) {
    setStreamingNotice(null);
    const restoreView = cmRef.current?.view;
    if (restoreView) {
      restoreView.dispatch({
        changes: { from: triggerPos, to: triggerPos, insert: triggerText },
        selection: { anchor: triggerPos + triggerText.length },
      });
    }
  }
  console.error("[slash_command]", res.error);
  return;
}
```

The restore is guarded by `mountedRef` so it never fires onto a stale
editor. The error is logged via `console.error("[slash_command]", …)` —
there is no toast at this layer.

## 8. Database Schema

Migration: `supabase/migrations/20260426000001_streaming_and_inline_ai.sql`.

Two changes:

1. **`operator_run_events.event_type` CHECK widened** to include
   `'text_delta'` (along with the existing event types), enabling
   token-level streaming events from the Modal harness.
2. **New table `public.inline_command_invocations`**:

   | Column | Type | Notes |
   |---|---|---|
   | `id` | `uuid` PK | default `gen_random_uuid()` |
   | `workspace_id` | `uuid` NOT NULL | FK `workspaces(id)` ON DELETE CASCADE |
   | `user_id` | `uuid` NOT NULL | FK `auth.users(id)` ON DELETE CASCADE |
   | `note_id` | `uuid` NOT NULL | FK `notes(id)` ON DELETE CASCADE |
   | `command_id` | `text` NOT NULL | built-in id or `skill:<uuid>` |
   | `subagent_invocation_id` | `uuid` NULL | FK `subagent_invocations(id)` ON DELETE SET NULL |
   | `selection_start` | `integer` NULL | caret offset at trigger |
   | `selection_end` | `integer` NULL | caret offset after trigger query |
   | `status` | `text` NOT NULL DEFAULT `'running'` | CHECK `IN ('running','completed','failed','cancelled')` |
   | `output` | `text` NULL | populated when `status = 'completed'` |
   | `error` | `text` NULL | populated on failure |
   | `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
   | `completed_at` | `timestamptz` NULL | |

   Indexes:
   - `idx_inline_command_invocations_note (note_id, created_at DESC)`
   - `idx_inline_command_invocations_workspace (workspace_id, created_at DESC)`

   **RLS:** enabled. Single policy
   `inline_command_invocations_member_select` grants `SELECT` to any
   user whose `workspace_memberships` row matches
   `inline_command_invocations.workspace_id`. Inserts and updates go
   through the service-role admin client used by
   `runInlineCommandAction` and the Modal streaming callback — there is
   intentionally no INSERT/UPDATE policy for regular users.

## 9. UI Streaming Notice

While a command is in flight, the editor renders a pill at the bottom-
right corner:

```tsx
{streamingNotice && (
  <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-foreground/80 px-3 py-1 text-[11px] text-background shadow-md">
    {streamingNotice}
  </div>
)}
```

`streamingNotice` is set to `"Running…"` right after dispatch and
cleared on completion, failure, or cancellation. It is pointer-events
disabled so it never intercepts editor clicks.

## 10. Future Work

The client currently consumes inline-command output via the 1-second
polling loop in section 6. Token-level streaming is wired-for but not
live — the migration already widens `operator_run_events.event_type` to
include `'text_delta'`, and the comment above the poll loop in
`dispatchCommand` reads:

```ts
// Poll for completion. Streaming token-by-token into the editor is
// wired up in 7E once Modal emits text_delta events.
```

When Modal begins emitting `text_delta` events, the editor should
switch to an SSE stream on `/api/agent/subagents/[id]/stream`
(referenced in the doc comment on `runInlineCommandAction`) and apply
deltas at `triggerPos`, falling back to polling only if the stream
drops. <!-- TODO: verify SSE endpoint URL once 7E lands -->
