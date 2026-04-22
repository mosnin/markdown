# Automation — v1 (Inngest)

Durable workflow layer that turns the `agent_triggers` table into an actual execution engine. Agents configured with a trigger (schedule, note_created, note_updated, or manual) now *fire* — with retries, dead-letter queue semantics, idempotency, and observability — rather than sitting inert in the database.

## Why Inngest

Options considered:

| Option | Fit |
|--------|-----|
| **Inngest** | ✓ Generous free tier; React-native function definitions; works with Next.js App Router out of the box; durable execution survives restarts; built-in cron, event fan-out, retries |
| Trigger.dev | Similar capabilities, rougher Next.js integration in early versions |
| pg_cron only | Only handles cron, not event fan-out. No retries, no idempotency, no observability |
| Vercel Cron + custom queue | Ships fastest but we'd re-implement every feature Inngest gives us |

We pick Inngest. If we ever need to swap, the only coupling is `src/lib/inngest/` and the `/api/inngest` route; the `agent_triggers` schema and the run-recording path stay the same.

## Subsystem map

```
                 ┌─────────────────────────┐
                 │   Triggers table        │
                 │   (v1, already built)    │
                 └────────────┬────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
  ┌──────────────┐   ┌──────────────┐    ┌──────────────┐
  │ note.created │   │ Cron minute  │    │ Manual "Run  │
  │ note.updated │   │ scheduler     │    │ now" click   │
  │ (event)      │   │ (Inngest cron)│    │ (event)      │
  └──────┬───────┘   └──────┬───────┘    └──────┬───────┘
         │                  │                   │
         ▼                  ▼                   ▼
  ┌──────────────┐   ┌──────────────┐    ┌──────────────┐
  │ executeNote  │   │ executeSched │    │ executeManual│
  │ Trigger()    │   │ uledTriggers │    │ Trigger()    │
  └──────┬───────┘   └──────┬───────┘    └──────┬───────┘
         │                  │                   │
         └──────────┬───────┴───────────────────┘
                    ▼
            ┌──────────────┐
            │ runAgent     │   ← shared execution path
            │ Execution()  │
            └──────┬───────┘
                   │
         ┌─────────┴──────────┐
         ▼                    ▼
  ┌────────────┐       ┌────────────┐
  │ agent_     │       │ dispatch   │
  │ trigger_   │       │ OperatorRun│
  │ runs row   │       │ (Modal)    │
  └────────────┘       └────────────┘
```

## Events

Published into Inngest by server actions / API routes:

- **`note.created`** — payload `{ workspaceId, noteId, boxId, userId }` — emitted from `createNoteAction` after successful insert.
- **`note.updated`** — payload `{ workspaceId, noteId, boxId, userId, isFirstSave }` — emitted from `saveNoteAction` after successful version write. `isFirstSave` is true when `version_number` is 1.
- **`agent_trigger.manual`** — payload `{ triggerId, workspaceId, userId }` — emitted from the "Run now" button.

Only the knowledge graph extraction + backfill workers already use `after()`. All new fan-out goes through Inngest events — this keeps the event taxonomy in one place.

## Inngest functions

All live under `src/lib/inngest/functions/` and are registered in the `/api/inngest` route.

### `executeNoteTrigger`
- Subscribes to `note.created` and `note.updated`
- Looks up `agent_triggers` where `(trigger_type IN ('note_created','note_updated') AND is_enabled AND (box_id IS NULL OR box_id = event.boxId))`
- For each match, records a row in `agent_trigger_runs` and dispatches via `runAgentExecution`

### `executeScheduledTriggers`
- `cron: "* * * * *"` — runs every minute
- Loads `agent_triggers` where `trigger_type='schedule' AND is_enabled=true`
- For each trigger, uses `cron-parser` to compute whether the cron expression has a scheduled time that falls within the last 60 seconds. If yes, fire.
- Idempotency is handled by Inngest's function-level idempotency key: `${trigger.id}:${scheduled_time_iso}` — duplicate fires in the same minute are deduped at the Inngest layer.

### `executeManualTrigger`
- Subscribes to `agent_trigger.manual`
- Single-shot: record a run, call `runAgentExecution`, mark done.

### `runAgentExecution` (shared helper)
- Creates `agent_trigger_runs` row with `status='running'`
- Calls `dispatchOperatorRun` with the agent's system_prompt as the operator instructions
- On success: updates row with `status='completed'`, links the resulting `workspace_operator_runs.id`
- On failure: updates row with `status='failed'`, persists error message
- On retry: Inngest wraps each step in its automatic retry (3 attempts, exponential backoff). Final failure is recorded as `status='failed'`. We do NOT retry in application code — Inngest owns retry policy.

## Data model

### `agent_trigger_runs`
One row per fire. Source of truth for "how often did this trigger run and was it healthy?"

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workspace_id | uuid FK | cascade delete |
| trigger_id | uuid FK | cascade delete |
| agent_id | uuid FK | cascade delete |
| status | text | enum: running / completed / failed / skipped |
| started_at | timestamptz | set on insert |
| completed_at | timestamptz | set on terminal status |
| error | text | null unless failed |
| workspace_operator_run_id | uuid FK | nullable; set once the Modal run is created |
| created_at | timestamptz | default now() |

Indexes: `(trigger_id, started_at DESC)`, `(workspace_id, started_at DESC)`, `(status) WHERE status='running'` for stuck-run detection.

## Environment

| Variable | Purpose | Required |
|----------|---------|----------|
| `INNGEST_EVENT_KEY` | Authenticates event publish | Production only |
| `INNGEST_SIGNING_KEY` | Verifies incoming function-invocation requests | Production only |
| `INNGEST_DEV` | Set to `"1"` locally to use the Inngest dev server | Dev only |

In development, `pnpm inngest-cli dev` or `npx inngest-cli@latest dev` runs a local dev server at `http://localhost:8288` that auto-discovers our functions via the `/api/inngest` route.

## Idempotency

Three layers:

1. **Inngest function idempotency key** — `(trigger_id, scheduled_time_iso)` for scheduled triggers, `(trigger_id, event.noteId, event.ts_minute)` for event triggers. Prevents duplicate fires within the dedup window.
2. **`agent_trigger_runs` row** — every fire gets a row; the UI reads this as ground truth. If Inngest double-fires despite the key, we see two rows and can detect it.
3. **Application-level guard** — `runAgentExecution` checks for a `running`-status row for the same trigger that started within the last 5 minutes; if found, marks the new attempt as `skipped` with reason `"previous still running"`.

## Retry policy

Inngest defaults: 3 attempts with exponential backoff (30s, 2m, 8m). Applied per-step, so a transient network failure to Modal does not double-bill us or kick off a second operator run.

Final failure after 3 attempts:
- `agent_trigger_runs.status = 'failed'`
- `agent_trigger_runs.error` set to the final exception message
- Inngest's DLQ retains the raw event for 7 days on the free plan (30 days on paid)

## Observability

- `agent_trigger_runs` is the app-level log
- Inngest's dashboard shows per-function invocations, retries, and failures
- `AgentTriggersPanel` surfaces the last 10 runs per trigger + success rate over the last 50 runs

## Runbook

**"My trigger isn't firing"** — check (1) `is_enabled=true`, (2) no recent `status='running'` rows older than 5 minutes (might be stuck), (3) Inngest dashboard for function invocations, (4) `WORKSPACE_OPERATOR_ENABLED=true` and `EMBEDDING_API_KEY` set.

**"Trigger is firing twice"** — check the Inngest function idempotency key is being generated correctly; look for two `agent_trigger_runs` rows with `started_at` within the dedup window.

**"Stuck runs"** — query `SELECT * FROM agent_trigger_runs WHERE status='running' AND started_at < now() - interval '10 minutes'`. These indicate Modal timeouts where the terminal-status update was never recorded. A cron job (`clear_stuck_trigger_runs`) marks them `failed` after 30 minutes.

## What this does NOT yet ship

- **Slack / email notifications on trigger failure** — deferred.
- **Per-workspace Inngest key scoping** — single app-wide key for v1.
- **Trigger editing** — create/delete only; edit requires delete + create.
- **Cross-trigger dependencies** — "run agent B after agent A succeeds" — deferred to v2.
