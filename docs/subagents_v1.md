# Sub-agents + Skill Plugins — v1

Pattern borrowed directly from the Modal + OpenAI Agent SDK playbook: prevent context rot in long-running Pog runs by delegating focused tasks to disposable sub-agents whose transcripts never pollute the orchestrator. Built on top of the existing `skills` table — a skill with `is_subagent=true` is a callable sub-agent in the OpenAI Agent SDK sense.

## Why

Pog today is a single orchestrator with ~50 tools loaded into one context window. For a multi-step research task — "find the top RAG papers from 2024, visit each one, and write a survey note" — the orchestrator's context balloons with tool-call transcripts, citations, and intermediate reasoning. By the tenth step, token budget is half-consumed by artifacts that didn't help recent reasoning.

Delegation fixes this:

1. **Orchestrator** (Pog) decides *what* to do and *who* should do it.
2. **Sub-agent** does the focused work in a fresh context window with its own tool subset.
3. The sub-agent returns a structured summary (or final artifact id) back to Pog.
4. The sub-agent's transcript is discarded — Pog never sees it.

This is the standard OpenAI Agent SDK handoff pattern, adapted so sub-agents behave like tool-callable workers (orchestrator keeps running) rather than agent-swapping handoffs (orchestrator is replaced).

## Subsystem map

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER (Poggle UI)                    │
│  User → conversation → Pog run                                │
└─────────────────────────┬────────────────────────────────────┘
                          │ startConversationTurnAction
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  MODAL ORCHESTRATOR (Pog)                      │
│  Agents SDK Session — holds the running context                │
│  Tools:                                                        │
│    • all existing Pog tools (search, read_note, draft_note…)  │
│    • list_skills_plugins        ← new                          │
│    • invoke_subagent            ← new                          │
│    • await_subagent             ← new                          │
└─────────────┬──────────────────────────────────────────────────┘
              │ /api/agent/tools/invoke_subagent
              ▼
┌──────────────────────────────────────────────────────────────┐
│                    NEXT.JS DISPATCH LAYER                      │
│   invokeSubagentAction                                         │
│     ├── resolve skill (id + is_subagent=true)                 │
│     ├── write subagent_invocations row (status=queued)         │
│     └── delegate to Modal via dispatchSubagentRun()            │
└─────────────┬──────────────────────────────────────────────────┘
              │ (Modal-side Python — separate deploy)
              ▼
┌──────────────────────────────────────────────────────────────┐
│                 MODAL SUBAGENT (fresh Session)                 │
│   system_prompt = skill.system_prompt                          │
│   tools = [ only tools in skill.subagent_tools whitelist ]     │
│   runs to completion → returns final summary                   │
└─────────────┬──────────────────────────────────────────────────┘
              │ /api/agent/tools/subagent_complete (callback)
              ▼
┌──────────────────────────────────────────────────────────────┐
│   subagent_invocations.status = 'completed', summary = ...     │
│   Orchestrator calls await_subagent → gets summary             │
└──────────────────────────────────────────────────────────────┘
```

## Data model

### Extends `skills`
| Column | Type | Notes |
|--------|------|-------|
| is_subagent | boolean | default false; when true this skill is invokable as a subagent |
| subagent_tools | text[] | whitelist of tool names the subagent can use; null = all tools |
| subagent_max_turns | int | hard cap on agent loop iterations; default 20 |

### `subagent_invocations`
One row per sub-agent call. The orchestrator queries this via `await_subagent(invocation_id)`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workspace_id | uuid FK | cascade delete |
| parent_operator_run_id | uuid FK | the orchestrator run that invoked the subagent |
| skill_id | uuid FK | which skill drove this sub-agent |
| user_id | uuid FK | attribution |
| task | text | input prompt from the orchestrator |
| status | text | queued / running / completed / failed / cancelled |
| summary | text | final message from the sub-agent |
| error | text | null unless failed |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| tool_calls_count | int | for budget transparency |
| input_tokens | int | |
| output_tokens | int | |
| modal_run_id | text | external id from Modal dispatch (for cancellation) |

Indexes: `(parent_operator_run_id, started_at DESC)`, `(workspace_id, started_at DESC)`, `(status) WHERE status IN ('queued','running')` for stuck-run detection.

## Tools exposed to the orchestrator

### `list_skills_plugins`
`POST /api/agent/tools/list_skills_plugins`

Returns available skills marked `is_subagent=true`, in descending order of recent use. The orchestrator decides which ones to invoke based on descriptions.

Response: `{ skills: [{ id, name, description, subagent_tools }] }`

### `invoke_subagent`
`POST /api/agent/tools/invoke_subagent`

Request:
```json
{
  "skill_id": "<uuid>",
  "task": "<natural language task>",
  "wait": true
}
```

When `wait=true`: blocks until the sub-agent completes, returns `{ invocation_id, status, summary }`.
When `wait=false`: returns immediately with `{ invocation_id, status: 'queued' }` so the orchestrator can fan out N parallel sub-agents and await them later.

### `await_subagent`
`POST /api/agent/tools/await_subagent`

Request: `{ invocation_id, timeout_ms?: 60000 }`.

Returns `{ status, summary, error }`. Polls Modal for completion; returns `status: 'running'` if not done within the timeout (orchestrator can call again).

## Lifecycle

1. Orchestrator calls `invoke_subagent({ skill_id, task, wait: false })`.
2. Next.js inserts `subagent_invocations` row with `status='queued'`, dispatches to Modal with envelope headers (workspace_id, user_id, skill_id, invocation_id).
3. Modal spins up a fresh Agent SDK session:
   - system prompt = skill.system_prompt
   - tools = skill.subagent_tools filtered from the full tool catalogue
   - max_turns = skill.subagent_max_turns
4. Sub-agent runs to completion — may call any whitelisted tool, INCLUDING `invoke_subagent` (recursive sub-agents, capped at 2 levels deep by default).
5. On finish, Modal POSTs `/api/agent/tools/subagent_complete` with `{ invocation_id, summary, token counts }`.
6. Next.js updates the row `status='completed'` + summary.
7. Orchestrator calls `await_subagent` — gets back the summary only. No transcripts, no intermediate reasoning.

## Context isolation guarantees

- Sub-agent Sessions are created with `conversation_history=[]` — nothing from the orchestrator leaks into the sub-agent's context.
- Sub-agent tool-call transcripts are never returned to the orchestrator — only the final `summary` field.
- The orchestrator sees only: invocation id, status, summary, token/tool counts (for budget awareness).
- The full sub-agent transcript is stored as a normal `workspace_operator_runs` row (via Modal's normal pipeline) so users can inspect it in the UI — but it's never re-injected into the orchestrator's context.

## UI layer

### Skill editor gains a "Sub-agent" tab
Toggle `is_subagent=true` + pick a subset of tools + set `subagent_max_turns`. When toggled on, the skill appears in the orchestrator's `list_skills_plugins` return value.

### `/app/sub_agents`
Recent sub-agent invocations list: skill name, task excerpt, status, duration, token count. Click-through to the invocation detail page.

### `SubagentInvocationBadge`
When a Pog conversation run has invoked sub-agents, render a small fanout widget showing the delegated runs. Each badge links to the sub-agent invocation detail.

## Budget + rate limits

- Each `invoke_subagent` counts against the parent's `workspace_operator_runs` token quota (sub-agent tokens roll up to the parent run's usage record).
- `subagent_invocations_rate_limit`: 10/minute per workspace. Prevents runaway recursion.
- `subagent_max_turns` cap prevents individual sub-agent loops from burning infinite budget.
- Recursion depth cap: a sub-agent invoking another sub-agent is allowed up to 2 levels deep; invocation past that fails immediately.

## What this does NOT ship in v1

- **Streaming sub-agent output** — orchestrator waits for completion before seeing anything. Streaming partial updates is v2.
- **Shared filesystem between sub-agents** — Modal's filesystem-as-memory pattern is deferred until we build a workspace-scoped sandbox layer.
- **Human-in-the-loop approval on sub-agent invocation** — for v1 the orchestrator invokes freely. Per-skill approval policies are v2.
- **Fan-in across workspaces** — sub-agents are scoped to a single workspace's data.
