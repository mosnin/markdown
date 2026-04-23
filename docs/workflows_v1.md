# Workflow Designer — v1

Visual DAG builder where users assemble sub-agents, web tools, and transformations into reusable multi-step flows. Think "Zapier for the knowledge-graph + agent infrastructure we already have."

## Why

Phase 2 (triggers) fires an agent. Phase 5 (web tools) gives it the web. Phase 6 (sub-agents) lets it delegate. But every non-trivial task today requires writing a new skill whose system prompt hand-orchestrates sub-steps in natural language — fragile and not composable.

Workflows make the orchestration *structure* explicit:

- **Visual** — node-link diagram on `@xyflow/react` (already used in `/app/graph`)
- **Declarative** — graph stored as structured data, not a prompt
- **Composable** — every sub-agent skill becomes a drop-in node; web tools become nodes; transformations become nodes
- **Durable** — execution uses Phase 2's Inngest infrastructure so runs survive restarts
- **Observable** — per-node run status + output makes debugging trivial

## Subsystem map

```
┌──────────────────────────────────────────────────────────────┐
│                   DESIGNER UI  (/app/workflows/[id]/edit)    │
│   WorkflowCanvas (xyflow)                                     │
│     ├── node palette (sidebar)                                │
│     ├── node types: start, subagent, web_search, web_fetch,   │
│     │              transform, condition, merge, end           │
│     ├── edge drag handles                                     │
│     ├── property panel (edit selected node config)            │
│     └── Save / Run Now                                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  SERVER ACTIONS + REPOSITORIES                │
│   saveWorkflowAction / runWorkflowAction / listWorkflowsAction│
│   workflow_repository / workflow_run_repository               │
│   validateWorkflowGraph (acyclic check, ref check, one start) │
└─────────────────────────┬───────────────────────────────────┘
                          │ publish 'workflow.run' event
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                 INNGEST EXECUTION ENGINE                      │
│   executeWorkflow function                                    │
│     ├── load graph + create workflow_runs row                 │
│     ├── topological sort of nodes                             │
│     ├── for each node: step.run(...) with retries             │
│     │     - subagent → dispatchSubagentRun + await            │
│     │     - web_search → exaSearch / tavily                   │
│     │     - web_fetch → web_fetch route                       │
│     │     - transform → LLM call with prompt                  │
│     │     - condition → evaluate expression                   │
│     │     - merge → combine parallel branches                 │
│     └── write workflow_node_runs row per node                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ Supabase realtime
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                 RUN VIEWER  (/app/workflows/runs/[id])        │
│   Live-updating node list with status + output preview        │
│   Canvas overlay: node color-coded by current status          │
└──────────────────────────────────────────────────────────────┘
```

## Data model

### `workflows`
One row per saved workflow.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workspace_id | uuid FK | cascade delete |
| user_id | uuid FK | creator |
| name | text | |
| description | text | |
| status | text | draft / active / archived |
| trigger_id | uuid FK agent_triggers | nullable; when set, workflow fires on the trigger |
| graph | jsonb | denormalised snapshot of nodes + edges for fast reads; source of truth lives in workflow_nodes / workflow_edges |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `workflow_nodes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK | cascade delete |
| node_key | text | stable within workflow (e.g. `search_papers`); UNIQUE(workflow_id, node_key) |
| node_type | text | start / subagent / web_search / web_fetch / transform / condition / merge / end |
| position | jsonb | `{x, y}` for canvas persistence |
| config | jsonb | type-specific: skill_id for subagent, prompt for transform, query template for web_search, etc. |

### `workflow_edges`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK | cascade delete |
| source_node_id | uuid FK | cascade delete |
| target_node_id | uuid FK | cascade delete |
| source_handle | text | for condition nodes: `"true"` or `"false"`; else null |
| label | text | optional human label |

### `workflow_runs`
One row per execution.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK | |
| workspace_id | uuid FK | |
| user_id | uuid FK | null for trigger-initiated |
| status | text | queued / running / completed / failed / cancelled |
| input | jsonb | trigger or manual input |
| output | jsonb | final output (from end node) |
| error | text | null unless failed |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| total_cost_cents | int | rolls up web_tool_usage + subagent token costs |

### `workflow_node_runs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_run_id | uuid FK | cascade delete |
| node_id | uuid FK workflow_nodes | |
| status | text | pending / running / completed / failed / skipped |
| input | jsonb | resolved input (after template interpolation) |
| output | jsonb | node's output |
| error | text | |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| subagent_invocation_id | uuid FK | nullable; for subagent nodes |

## Node types

### `start`
Entry point. Exactly one per workflow. Output is the workflow's input (user-provided or trigger payload).

### `subagent`
Config: `{ skill_id: uuid, task_template: string }`. `task_template` can reference upstream outputs via `{{start.output}}` / `{{search_papers.output[0].title}}`. Invokes the skill via `dispatchSubagentRun`.

### `web_search`
Config: `{ query_template: string, provider: "exa" | "tavily", num_results: int }`. Calls the corresponding existing tool. Output: array of `{ url, title, text, score }`.

### `web_fetch`
Config: `{ url_template: string }`. Resolves template, fetches URL via existing web_fetch route. Output: `{ url, text, final_url }`.

### `transform`
Config: `{ system_prompt: string, user_prompt_template: string, model?: string }`. One-shot LLM call. Cheap + deterministic way to reshape data between nodes.

### `condition`
Config: `{ expression: string }`. Boolean expression over previous outputs (v1 uses a very limited DSL: `{{nodeKey.field}} == "value"` or `.length > N`). Has two outgoing handles: `true` and `false`.

### `merge`
Joins parallel branches. Output is an object with one key per incoming edge. No config.

### `end`
Terminal node. Output = its input. Workflow run's final output.

## Template interpolation

Inputs, prompts, and URLs resolve `{{nodeKey.path}}` against a running context of upstream node outputs. Paths are JSON pointer-ish: `{{search_papers.output[0].title}}`.

Safety:
- Templates never reach eval — resolved via explicit traversal.
- Missing paths resolve to empty string with a warning event.
- Circular references blocked by the DAG validation step.

## Execution

Single Inngest function: `executeWorkflow`. Event: `workflow.run` with `{ workflowId, workspaceId, userId, input }`.

Steps:

1. `step.run("load-graph", ...)` — fetches workflow + nodes + edges, validates.
2. `step.run("create-run", ...)` — inserts `workflow_runs` row.
3. Topologically sort nodes.
4. For each node in order:
   - `step.run(\`node-${node_key}\`, ...)` — resolves template inputs, dispatches based on `node_type`, writes `workflow_node_runs` row, stores output in run context.
   - On failure, mark node `failed`, cascade-skip dependents, mark run `failed`.
5. Write final `workflow_runs.output` + `status='completed'`.

Each `step.run` is retryable at the Inngest layer (3 attempts, exponential backoff), so transient failures don't kill the whole run.

## Validation

`validateWorkflowGraph(graph)` called before every save:

- Exactly one `start` node.
- At most one `end` node (zero is allowed but the workflow is "advisory").
- Graph is acyclic (topological sort succeeds).
- Every node has valid `config` for its type (skill_id resolves, prompt non-empty, etc.).
- Every template reference resolves to an upstream node that exists.
- Every edge endpoint exists.

Returns `{ ok: true } | { ok: false; errors: string[] }`. UI blocks save with an error banner if `ok: false`.

## Security

- Workflows + runs RLS-scoped to workspace membership.
- Execution runs under the service role, but every tool dispatch (web_search, web_fetch, subagent) re-verifies workspace membership.
- `condition` expression DSL is intentionally limited (no arithmetic, no function calls) to block RCE via injection.

## UI layer

- **`/app/workflows`** — list of saved workflows + "New workflow" action.
- **`/app/workflows/[id]/edit`** — canvas builder.
- **`/app/workflows/runs/[id]`** — live run viewer with node timing + output preview.
- **`WorkflowCanvas`** — `@xyflow/react` viewport with custom node components per node_type.
- **`NodePropertiesPanel`** — right-side panel editing the selected node's config.
- **`WorkflowRunBadge`** — inline badge on the workflows list showing latest run status.

## What this does NOT ship

- **Loops** — v1 is strictly a DAG. `for each` constructs are v2.
- **Parallel execution** — nodes execute sequentially even when the graph permits parallelism. Fan-out is deferred.
- **Live editing** — no CRDT on the canvas; last-write-wins per save. Multiplayer editing of workflows is v2.
- **Cross-workspace sharing** — a workflow belongs to one workspace. Template library (exports) is Phase 8F, also deferred.

---

## Schedule triggers (cron)

Workflows can be set to fire automatically on a cron schedule. This builds on the existing `agent_triggers` table and Inngest `execute_scheduled_triggers` function.

### How it works

1. A `cron_expression` (standard 5-field POSIX cron) is stored in an `agent_triggers` row associated with the workflow via `workflows.trigger_id`.
2. The Inngest `execute_scheduled_triggers` function runs on a cron and queries `agent_triggers` for rows whose next-fire time has passed.
3. For each due trigger, it publishes a `workflow.run` event, which starts `executeWorkflow`.

### Server actions

All schedule actions are in `src/app/app/workflows/actions.ts`:

#### `setWorkflowScheduleAction(workflowId, cronExpression, enabled?)`

Creates or updates the cron trigger for a workflow. If a trigger already exists (`workflow.trigger_id` is set), it updates the expression and enabled state in place. On first creation:

1. Creates the `agent_triggers` row with `is_enabled: false`.
2. Links it to the workflow (`update workflows set trigger_id = ...`).
3. If `enabled` is true, re-enables the trigger after the link succeeds.
4. On link failure, deletes the orphan trigger row to avoid ghost rows.

Returns `{ ok: true; triggerId: string } | { ok: false; error: string }`.

#### `clearWorkflowScheduleAction(workflowId)`

Removes the schedule. Nulls the workflow FK first, then deletes the `agent_triggers` row to avoid a dangling FK reference.

#### `getWorkflowScheduleAction(workflowId)`

Returns the current trigger info:

```ts
type WorkflowScheduleInfo = {
  id: string;
  cron_expression: string | null;
  is_enabled: boolean;
  label: string;        // human-readable, e.g. "Every day at 9:00 AM"
};
```

### Cron expression format

Cron expressions are validated and described by `describeCron()` in `src/lib/cron.ts` before they are persisted. Invalid expressions are rejected at the action layer with a user-facing error. The label field (e.g. "Every Monday at 9:00 AM") is computed from the expression and stored for display.

Standard 5-field cron: `minute hour day-of-month month day-of-week`. Examples:

| Expression | Meaning |
|---|---|
| `0 9 * * 1` | Every Monday at 09:00 UTC |
| `0 */6 * * *` | Every 6 hours |
| `30 8 * * 1-5` | Weekdays at 08:30 UTC |
| `0 0 1 * *` | First day of every month |

---

## Built-in workflow templates

Five templates ship with the app in `src/server/domain/workflow_templates.ts`. They are available via the **New from template** gallery in `/app/workflows`.

| ID | Name | Category | Description |
|---|---|---|---|
| `news-digest` | Daily news digest | content | Search the web for today's top AI news and summarise it into a tidy bullet list. |
| `competitor-monitor` | Competitor monitor | monitoring | Fetch a competitor's pricing page and call out any changes compared to the previous snapshot. |
| `research-assistant` | Research assistant | research | Search the web on a topic, extract key facts, then hand the top results to a sub-agent for a deeper dive. |
| `content-summarizer` | Content summarizer | content | Fetch a URL and condense the article into a crisp 200-word summary. |
| `multi-source-aggregator` | Multi-source aggregator | research | Run two web searches and a page fetch in parallel, merge the results, then synthesise a unified brief. |

Templates are cloned into a new `workflows` row via `createWorkflowFromTemplateAction`. The graph is validated before any DB writes; invalid template graphs surface as a `500` with detail.

The `research-assistant` template contains a `subagent` node with `skill_id: "REPLACE_ME_WITH_SKILL_ID"` as a placeholder — users must substitute a real skill ID after cloning.

---

## Server actions reference

All actions live in `src/app/app/workflows/actions.ts` and are `"use server"` functions requiring an authenticated session.

| Action | Parameters | Returns |
|---|---|---|
| `createWorkflowAction` | `name: string` | `{ ok: true; workflowId }` |
| `createWorkflowFromTemplateAction` | `templateId, customName?` | `{ ok: true; workflowId }` |
| `saveWorkflowAction` | `workflowId, { name?, description?, graph? }` | `{ ok: true } \| { ok: false; validationErrors? }` |
| `runWorkflowAction` | `workflowId, input?` | `{ ok: true; runId }` |
| `listWorkflowsAction` | — | `{ ok: true; workflows: Workflow[] }` |
| `getWorkflowAction` | `workflowId` | `{ ok: true; workflow }` |
| `setWorkflowScheduleAction` | `workflowId, cronExpression, enabled?` | `{ ok: true; triggerId }` |
| `clearWorkflowScheduleAction` | `workflowId` | `{ ok: true }` |
| `getWorkflowScheduleAction` | `workflowId` | `{ ok: true; trigger: WorkflowScheduleInfo \| null }` |

All actions revalidate the relevant Next.js path cache entries on success.
