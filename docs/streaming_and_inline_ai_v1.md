# Streaming + Inline AI + Cmd+K — v1

Three tightly-linked UX pieces that make Pog feel alive:

1. **Streaming agent responses** — token-by-token output via Server-Sent Events, so users see Pog think instead of staring at a spinner.
2. **Inline slash commands** — type `/` in the note editor to invoke sub-agents (summarize / expand / translate / cite) with streaming output inserted into the doc at the caret.
3. **Cmd+K palette** — context-aware jump menu that surfaces notes, entities (Phase 1), sub-agents (Phase 6), and actions. Uses the already-installed `cmdk` library.

Streaming is the plumbing; the other two are surfaces that showcase it.

## Subsystem map

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER                                │
│                                                               │
│  ConversationView   ──EventSource──►  /api/operator/runs/[id]/stream
│  NoteCrdtEditor      ──invokes──►     inline_command action       │
│       └── SlashMenu (CodeMirror ext)                              │
│  CommandPalette     ──Cmd+K──►        context-aware dispatcher   │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                      NEXT.JS SSE LAYER                        │
│                                                               │
│  /api/operator/runs/[id]/stream  (GET, text/event-stream)    │
│    ├── subscribes to Supabase Realtime                        │
│    ├── channel: operator_run_events:{run_id}                  │
│    ├── forwards INSERTs as SSE events                         │
│    └── closes on run_end / completed / failed                 │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                       SUPABASE                                │
│                                                               │
│  operator_run_events table (existing, Phase 1 of main app)    │
│    + new event_type: 'text_delta' for token streaming         │
│    Realtime broadcasts INSERTs to subscribed clients          │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                      MODAL HARNESS                            │
│                                                               │
│  Pog run streams OpenAI Agent SDK events → INSERTs rows into  │
│  operator_run_events. text_delta events carry token chunks.   │
└──────────────────────────────────────────────────────────────┘
```

## SSE endpoint

`GET /api/operator/runs/[id]/stream`

Authentication: session cookie OR `Authorization: Bearer wopr_...`. Authorisation: the run must belong to a workspace the caller has membership in.

Response: `text/event-stream`. Each event:

```
event: <event_type>
id: <sequence>
data: {"sequence": N, "event_type": "...", "payload": {...}}
```

Client reconnection via the `Last-Event-ID` header — we resume by passing `afterSequence = <last-id>` to `listEventsForRun`.

### Event lifecycle

1. Client opens EventSource → handler reads history via `listEventsForRun` and flushes every prior event.
2. Handler subscribes to Supabase Realtime channel `operator_run_events:{run_id}`.
3. Each INSERT is forwarded as an SSE event.
4. On events `completed` / `failed` / `cancelled`, the server sends a final `done` event and closes the stream.

### Text delta events

New event type added to `OperatorRunEventType`:

```ts
"text_delta"        // payload: { text: string }
```

The Modal harness emits one `text_delta` per token (or small token group to reduce INSERT pressure). Clients accumulate deltas into the final assistant message.

## Inline slash commands

### CodeMirror extension — `slash_command_extension.ts`

Watches for `/` typed at line start or after whitespace. Opens a floating popover anchored at the caret showing a filterable command list. Enter invokes the command; Escape dismisses.

Commands are sourced from two places:
1. **Built-ins**: `/summarize`, `/expand`, `/translate`, `/cite`, `/outline`, `/rewrite`
2. **Workspace skills**: every skill with `is_subagent=true` appears in the list

### Command execution

1. User picks `/summarize` — popover closes, caret stays put.
2. Client calls a new server action `runInlineCommandAction({ commandId, noteId, selectionStart, selectionEnd, context })`.
3. Action resolves the command → a system prompt + sub-agent skill id.
4. Action dispatches to Modal via `dispatchSubagentRun` with the task: "Given this note context, [run the command]. Return only the replacement text."
5. Action returns an `invocation_id`.
6. Client opens EventSource on `/api/agent/subagents/[invocation_id]/stream` (new SSE endpoint for sub-agent streaming).
7. Streaming `text_delta` events are inserted at the caret as they arrive — via a Yjs transaction that other collaborators see in real time.
8. On `done`, the invocation's final summary replaces the streamed placeholder (idempotent cleanup).

### UX affordances

- While streaming, a subtle typing indicator appears under the insertion point.
- Escape during streaming cancels the invocation (`cancelSubagentInvocationAction`).
- Failed invocations roll back the inserted text with a toast.

## Cmd+K palette

### `CommandPalette` component

Global client component mounted at the app shell level. Keyboard listener on `cmd+k` / `ctrl+k` opens the overlay. Uses the `cmdk` library (already installed).

### Data sources

Ranked, up to 12 visible items:

1. **Actions** — "New note", "New box", "Start Pog", "Run recent agent X"
2. **Recent notes** — last 10 notes from workspace
3. **Entities** — top entities matching the query (Phase 1 GraphRAG)
4. **Sub-agents** — skills with `is_subagent=true` matching query
5. **Pages** — direct navigation to graph / insights / web sessions / settings

### Context-awareness

The palette inspects `usePathname()` to bias results:
- On `/app/boxes/[id]` — prioritises notes within that box
- On `/app/notes/[id]` — prioritises related notes via local embeddings (Phase 3)
- On `/app/conversation` — suggests sub-agents first

### Search

- Fuzzy match on title / name / description (client-side — all data already loaded)
- "Ask Pog: <query>" appears as a fallback action when no clean match

## Packages

No new runtime packages needed:
- `cmdk` already installed (used nowhere yet)
- `EventSource` is a browser built-in
- Supabase Realtime already plumbed

## Data model

Add one enum value — no schema migration needed for operator_run_events since the column is already `text` and the CHECK constraint is widened by a non-transactional `ALTER`:

```sql
ALTER TABLE public.operator_run_events
  DROP CONSTRAINT IF EXISTS operator_run_events_event_type_check;
ALTER TABLE public.operator_run_events
  ADD CONSTRAINT operator_run_events_event_type_check CHECK (event_type IN (
    'run_start', 'run_end', 'plan_ready', 'plan_approved',
    'step_start', 'step_complete',
    'tool_call_start', 'tool_call_end', 'tool_call_error',
    'tool_call_approval_requested', 'tool_call_approval_granted',
    'tool_call_approval_rejected', 'tool_call_preview_diff',
    'llm_call_start', 'llm_call_end',
    'usage_update', 'note_drafted',
    'steer_message_received', 'guardrail_tripped',
    'subagent_start', 'subagent_end',
    'text_delta',
    'completed', 'failed', 'cancelled'
  ));
```

One new table for inline command invocations (so they can be tracked independently of sub-agent invocations):

```sql
CREATE TABLE inline_command_invocations (
  id uuid PK,
  workspace_id uuid FK,
  user_id uuid FK,
  note_id uuid FK,
  command_id text,                          -- built-in id or skill:<uuid>
  subagent_invocation_id uuid FK null,      -- when dispatched to a sub-agent
  selection_start int,
  selection_end int,
  status text,                               -- running / completed / failed / cancelled
  output text,                               -- final inserted text
  created_at, completed_at
);
```

## Security

- **SSE auth**: stream endpoint verifies session cookie OR bearer token. Anonymous callers get 401.
- **Run isolation**: the stream handler fetches the run row with the caller's RLS client — RLS ensures a caller only sees runs in workspaces they belong to.
- **Inline command auth**: `runInlineCommandAction` goes through `requireAuthenticatedUser` and verifies note ownership.
- **Rate limits**: `inlineCommandLimit` — 30/min/user.

## What this does NOT ship

- **Interactive stream responses** — user can't type back mid-stream. Follow-up turn still requires a new run.
- **Voice input to Cmd+K** — Whisper integration is Phase 9.
- **Collaborative inline commands** — if two users trigger a slash command on the same selection simultaneously, last-write-wins on the Yjs doc. No merge UX.
- **Streaming into exports** — inline-command streams land in the editor only; no CSV / PDF / markdown export of the stream transcript.
