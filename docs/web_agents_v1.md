# Deep Research — v1 (Exa + Browserbase)

Gives agents access to the live web in three tiers, upgrading the existing Tavily-backed `web_search` + basic `web_fetch` baseline:

1. **Neural search (Exa)** — `deep_search` tool. Tavily ranks by page-level relevance; Exa's neural index returns semantically similar pages for natural-language queries ("find me papers that argue the opposite of X"). Dramatically better for research.
2. **Stateful browser (Browserbase)** — `browse_session` family. Tavily/Tavily-style search + a plain HTTP fetcher can't handle JS-heavy SPAs, auth-walled content, or multi-step flows ("log in, click through to the settings page, extract the API token"). Browserbase gives the agent a real Chrome with persistent cookies.
3. **Citations + budget** — every external fetch logs to `web_citations` and `web_tool_usage`. Workspaces get a per-month budget; Pog stops calling web tools when the cap is hit.

## Subsystem map

```
┌──────────────────────── AGENTS ─────────────────────────┐
│  Modal harness (Python)                                   │
│  └── tool calls → /api/agent/tools/*                      │
└──────────────┬───────────────────────┬──────────────────┘
               │                        │
   existing    │                        │   new in Phase 5
┌──────────────▼─────┐   ┌──────────────▼─────────────────┐
│ /agent/tools/      │   │ /agent/tools/                   │
│   web_search       │   │   deep_search                   │
│   web_fetch        │   │   browse_session_start          │
│ (Tavily + HTML)    │   │   browse_session_step           │
└──────────────┬─────┘   │   browse_session_end            │
               │         └──────────┬──────────────────────┘
               │                    │
               │                    ▼
               │         ┌──────────────────────────────┐
               │         │ web_research_service         │
               │         │   ├── exaSearch()            │
               │         │   ├── browserbaseStart()     │
               │         │   ├── browserbaseStep()      │
               │         │   └── browserbaseEnd()       │
               │         └──────────┬───────────────────┘
               │                    │
               └──────────┬─────────┘
                          ▼
           ┌─────────────────────────────────┐
           │  Budget + citations layer        │
           │    ├── web_tool_usage (table)    │
           │    ├── web_citations (table)     │
           │    ├── browsing_sessions (table) │
           │    └── checkWebBudget() service  │
           └─────────────────────────────────┘
                          ▲
                          │
           ┌──────────────┴───────────────────────┐
           │            UI LAYER                   │
           │  /app/web_sessions — history list     │
           │  /app/web_sessions/[id] — detail      │
           │  WebCitationBadge — inline source link│
           │  WebBudgetCard — settings panel       │
           └───────────────────────────────────────┘
```

## Why both Exa and Browserbase

| Use case | Right tool |
|----------|-----------|
| "What's the capital of France?" | Existing Tavily `web_search` — cheap & fast |
| "Find recent papers that argue memory-augmented LLMs don't help retrieval" | **Exa** `deep_search` — neural search over academic/long-form content |
| "Extract the pricing table from stripe.com/pricing" | Existing `web_fetch` — static HTML is enough |
| "Log into our admin dashboard and pull the last 7 days of user signups" | **Browserbase** `browse_session` — needs auth + interaction |
| "Read the first 3 Exa hits and summarize" | Exa + existing `web_fetch` chain |

The agent picks based on tool descriptions; we don't force a single provider.

## Tools added in v1

### `deep_search` (Exa)
`POST /api/agent/tools/deep_search`

Request:
```json
{
  "query": "LLM retrieval augmented generation drawbacks",
  "num_results": 10,
  "search_type": "neural" | "keyword" | "auto",
  "include_domains": ["arxiv.org", "anthropic.com"],
  "exclude_domains": ["reddit.com"],
  "start_published_date": "2024-01-01"
}
```

Response:
```json
{
  "run_id": "...",
  "results": [
    {
      "url": "https://arxiv.org/abs/...",
      "title": "...",
      "text": "<first ~1000 chars of the page>",
      "published_date": "2024-05-12",
      "score": 0.84,
      "highlights": ["...", "..."]
    }
  ]
}
```

Implementation: thin wrapper around `exa-js` SDK. Configured via `EXA_API_KEY` env var. Cost: logged to `web_tool_usage` as `tool_name='exa_search'`, `units=num_results`, `cost_cents` per Exa's pricing table.

### `browse_session_start`
`POST /api/agent/tools/browse_session_start`

Creates a Browserbase session and returns a session id the agent can reference in subsequent calls. Request: `{ goal: string }`. Response: `{ session_id, browserbase_session_id, live_url }`. `live_url` is a Browserbase-provided URL the human can open in another tab to watch the agent browse in real time.

### `browse_session_step`
`POST /api/agent/tools/browse_session_step`

Performs one action in an existing session. Request:
```json
{
  "session_id": "...",
  "action": "navigate" | "click" | "fill" | "extract" | "screenshot",
  "url": "...",             // for navigate
  "selector": "#login",      // for click / fill
  "value": "...",            // for fill
  "extraction_mode": "readable" | "full_html"  // for extract
}
```

Response: `{ url, extracted_text, screenshot_url, action_took_ms }`. Every step writes a row to `browsing_session_steps`.

### `browse_session_end`
`POST /api/agent/tools/browse_session_end`

Terminates the session, releases the Browserbase browser, and updates `browsing_sessions.status = 'completed'`. Idempotent.

## Durable browsing via Inngest

A one-shot browse_session is fine for "fetch this page". But some agent tasks need a sustained multi-step flow that survives Modal cold-starts or operator cancellations:

> "Check GitHub for the top 3 open-source RAG projects, visit each repo, and summarize the architecture docs."

For these, the agent emits an `agent_web_research.start` Inngest event with `{ workspaceId, userId, operatorRunId, goal, plan }`. The `executeWebResearch` Inngest function:

1. Calls `browse_session_start` to get a session
2. Iterates over `plan` steps, each in its own `step.run(...)` (Inngest retries per-step on failure)
3. Persists results incrementally to `browsing_session_steps` so partial progress survives
4. Closes the session in `finally`

## Data model

### `web_tool_usage`
Per-call usage log. Source of truth for "how much has this workspace spent on web tools this month?"

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workspace_id | uuid FK | cascade delete |
| user_id | uuid FK | null for agent-initiated |
| tool_name | text | enum: exa_search / tavily_search / web_fetch / browserbase_session / browserbase_step |
| units | int | searches, pages, or seconds |
| cost_cents | int | running total attributed at call time |
| operator_run_id | uuid FK | nullable |
| metadata | jsonb | tool-specific extras |
| created_at | timestamptz | |

### `browsing_sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | internal id |
| workspace_id | uuid FK | |
| user_id | uuid FK | owner |
| operator_run_id | uuid FK | nullable |
| browserbase_session_id | text | external id |
| status | text | active / completed / failed / timed_out |
| goal | text | natural-language description |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| error | text | null on success |
| page_count | int | steps executed |
| total_cost_cents | int | final bill |

### `browsing_session_steps`
One row per navigate/click/extract/etc action. Powers the session replay UI.

### `web_citations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workspace_id | uuid FK | |
| operator_run_id | uuid FK | null for unattributed |
| source_type | text | exa / tavily / browserbase |
| url | text | |
| title | text | |
| excerpt | text | 1–2 sentence quote |
| fetched_at | timestamptz | |

Citations render as small link badges inline in agent responses (UI layer).

## Budget governance

- `workspaces.web_tool_budget_cents` — monthly cap (default 500 = $5/mo).
- `checkWebBudget(workspaceId)` — called by every web tool before external call. Returns `{ allowed, current_cents, budget_cents }`. On `!allowed`, route returns `402 Payment Required` and the agent surfaces "budget exhausted" in the response.
- Budget resets on the first of each month (computed, not scheduled — just `WHERE created_at >= date_trunc('month', now())`).
- Settings panel (`WebBudgetCard`) shows current-month spend with a progress bar + "Edit" button to change the budget (admin-only).

## Packages

| Package | Purpose |
|---------|---------|
| `exa-js` | Exa SDK |
| `@browserbasehq/sdk` | Browserbase SDK (session create, live URL, release) |
| `playwright-core` | Browserbase driver — we connect to the Browserbase session via Playwright's CDP bridge |

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `EXA_API_KEY` | For deep_search | Exa API authentication |
| `BROWSERBASE_API_KEY` | For browse_session | Browserbase auth |
| `BROWSERBASE_PROJECT_ID` | For browse_session | Browserbase project |
| `WEB_TOOL_DEFAULT_BUDGET_CENTS` | No (default 500) | Global default when `workspaces.web_tool_budget_cents` is null |

## What this does NOT ship

- **Screenshot storage** — Browserbase provides screenshot URLs; we cache them transiently but don't durably store to Supabase Storage. Deferred.
- **Visual regression / diffing** — comparing screenshots across runs for monitoring-style agents. Deferred.
- **Custom Browserbase authentication flows** — cookie/localStorage pre-seeding for sites the workspace has credentials for. Deferred.
- **Real-time live-session co-pilot** — human watching the live browser session can intervene mid-flow. The `live_url` surfaces it but the handoff UX is deferred.
