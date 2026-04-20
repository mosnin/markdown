# Workspace Operator (Modal Agent) — Feature + Progress Tracker

Living document for the Poggle-native agent ("Workspace Operator") that
runs on Modal using the OpenAI Agents SDK. Every phase merged into main
should update this file.

## Product thesis

Poggle is the only platform where an AI can *safely write to a knowledge
base* because branches + change-sets turn every agent write into a
reviewable diff. The Workspace Operator is the visible product that
monetizes this moat: a single agent, invoked against a workspace, that
produces finished deliverables as draft branches the user can accept,
edit, or discard.

## Architecture at a glance

```
[Next.js UI]
   │
   ▼  runWorkspaceOperatorAction() ── creates draft branch
[Next.js server action] ──── POST ───▶ [Modal: poggle-workspace-operator]
   ▲                                         │
   │   POST /api/agent/tools/*               │  OpenAI Agents SDK loop
   │    (shared secret + envelope)           ▼
   └───────────  ◀────────────────── hybrid_search / draft_note
                                            │
                                            ▼
                                    [cite guardrail]
```

Boundaries:
- **Python `/agent`** — OpenAI Agents SDK agent definition, Modal deploy
  target. Has no direct DB access; everything goes through HTTP back to
  Poggle.
- **Next.js `/api/agent/tools/*`** — internal endpoints the agent calls
  back into. Auth = shared secret + trusted (user, workspace, branch,
  run) envelope. Not exposed via OAuth.
- **Next.js `workspace_operator_service.ts`** — dispatches runs,
  verifies feature flag, forwards to Modal.
- **Next.js `runWorkspaceOperatorAction`** — orchestrates branch
  creation, Modal dispatch, audit recording.

## Feature flag

- `WORKSPACE_OPERATOR_ENABLED=true` in Next.js env
- `WORKSPACE_OPERATOR_URL` — Modal deployment URL
- `WORKSPACE_OPERATOR_SHARED_SECRET` — shared with Modal secret
- Off in all environments by default; enable per-deployment.

## Tools (v1)

| Tool            | Purpose                                         | Endpoint                            | Guardrails                     |
|-----------------|-------------------------------------------------|-------------------------------------|--------------------------------|
| `hybrid_search` | Semantic + keyword + graph search               | `POST /api/agent/tools/search`      | workspace-scoped via envelope  |
| `draft_note`    | Create a note on the run's draft branch         | `POST /api/agent/tools/draft_note`  | branch-scoped via envelope     |

Deferred to later phases: `read_note`, `edit_note`, `link_notes`,
`apply_template`, `web_fetch`, `execute_code` (Modal sandbox),
`restructure`, `query_external` (Slack/Gmail/Linear), `schedule_self`.

## Guardrails

- **Cite guardrail** (output) — agent outputs that mention drafting must
  contain at least one `[[note_id]]` wikilink. Lenient fallback allows
  Markdown-style `](uuid)` links. Trips → run is marked `failed`.
- **Branch-scope** (implicit) — `draft_note` rejects requests without a
  `branch_id` envelope header. Operator cannot write to main.
- **Workspace isolation** (implicit) — every service call verifies the
  target `box_id` / `note_id` belongs to the envelope's `workspace_id`.

## Phase plan

### ✅ Phase 1 — Plumbing (shipped)

End-to-end round-trip proof: prompt → branch → drafted note → diff.

- `/agent` Python package (pyproject.toml, src layout, tests)
- OpenAI Agents SDK Operator with `hybrid_search` + `draft_note` tools
- `cite` output guardrail
- Modal app entrypoint (`app.py`) — ready to deploy but not deployed
- Next.js `/api/agent/tools/{search,draft_note}` endpoints
- `workspace_operator_service.ts` + `runWorkspaceOperatorAction`
- `WORKSPACE_OPERATOR_ENABLED` feature flag gated on env vars
- 20 new vitest cases (793/793 passing)
- Python pytest harness (client, guardrails, models)

Not yet: UI surface, Modal deployment, real end-to-end smoke against a
live workspace.

### ✅ Phase 2 — Plan-approve-execute UI (shipped)

Full plan → approve → execute flow with live progress streaming.

- Python operator refactored into 3 modes: `plan`, `execute`, `full`
  (backward-compat)
- Planning agent: search-only, no draft, produces 3–7 step JSON plan
- Execute agent: runs approved plan with progress callbacks
- `PlanStep`, `PlanResult` pydantic models; `OperatorInput.mode` +
  `approved_plan` fields
- `PoggleClient.report_progress()` — fire-and-forget progress callbacks
- JSON plan parser with markdown-fence and embedded-JSON fallback
- `dispatchOperatorPlan` + `dispatchOperatorExecute` service dispatchers
- `requestOperatorPlanAction` + `approveAndExecuteAction` server actions
- `POST /api/agent/tools/progress` — receives progress from Modal,
  broadcasts via Supabase Realtime
- `useOperatorProgress` hook — subscribes to `operator_run:${runId}`
  broadcast channel
- `OperatorPanel` — Sheet-based side panel (480px) with idle / planning /
  awaiting_approval / executing / completed / failed phases
- Editable plan steps with tool badges (search=blue, draft=green,
  analysis=purple)
- Live step status (spinner, checkmark, X) + scrolling event log
- Command bar (⌘K) "Run Workspace Operator" entry
- `AgentBranchBanner` — "Generated by Workspace Operator" attribution
  on agent branches with notes-created / tool-calls badges
- Shared types: `OperatorPlanStep`, `OperatorProgressEvent`,
  `OperatorRunPhase`
- 20 new vitest cases (813/813 passing), 9 new pytest cases
- Python `_parse_plan` + `_extract_json_object` tested for raw JSON,
  fenced code blocks, embedded JSON, and malformed input

Not yet: Modal deployed to staging, end-to-end smoke test.

### ✅ Phase 3 — Tool completion + governance (shipped)

Five new tools, governance guardrails, durable run history, per-user
preferences, and SDK tracing wired into the activity feed.

- Tools: `read_note`, `edit_note`, `link_notes`, `apply_template`,
  `web_fetch` — Python `function_tool` wrappers + Next.js
  `/api/agent/tools/*` endpoints with envelope auth and branch-scope
  enforcement. `web_fetch` includes an SSRF guard (blocks `file://`,
  `localhost`, RFC1918, link-local, cloud metadata).
- Plan-mode tool inventory restricted to read-only:
  `hybrid_search`, `read_note`, `web_fetch`. Execute/full modes get all
  seven tools.
- Guardrails:
  - `must_cite_per_claim` — opt-in model-based output guardrail (uses a
    `gpt-4.1-mini` checker); soft-fails open on parse errors so it
    never silently breaks good runs.
  - `max_tool_calls` — `Settings.max_tool_calls` mapped onto the SDK's
    `Runner.run(max_turns=...)` (closest available primitive), enforced
    in all 3 modes.
  - Branch-scope enforcement tests — 12 vitest cases proving
    `draft_note`, `edit_note`, `link_notes` reject missing/empty
    `branch_id` and cross-workspace IDs.
- `workspace_operator_runs` table — durable run history with
  status/plan/result/notes_created/tool_calls/duration. RLS:
  workspace-member SELECT, actor-or-admin write. `runWorkspaceOperator`
  actions now create the row early, transition status, and capture
  outcome. New `/app/agents/runs` history page lists the user's recent
  runs across workspaces.
- `user_agent_preferences` table + settings card — tone, citation
  style, tool allowlist, strict-citation toggle, max-tool-calls slider
  (1–100 clamp). Self-only RLS. Defaults exported as
  `DEFAULT_USER_AGENT_PREFERENCES`.
- OpenAI Agents SDK tracing — `PoggleTracingProcessor` batches span
  events and POSTs fire-and-forget to `/api/agent/tools/trace`. Each
  event becomes an `audit_events` row (which is the activity feed's
  source of truth); "interesting" events (root traces, guardrail trips)
  also broadcast on `activity_feed:${workspaceId}` Realtime channel.
  Processor swallows all errors so tracing never breaks a run.
- 86 new vitest cases (985/985 passing), 47 new pytest cases (66/67
  passing — 1 pre-existing Phase 1 cite-guardrail false-positive
  unrelated to Phase 3)

Not yet: Modal deployed to staging, end-to-end smoke test against a
live workspace, history page filters/search.

### ✅ Phase 4 — Billing + launch (shipped)

Per-tier quotas, metered usage with cost accounting, prompt-cache
tuning for OpenAI auto-caching, and Business tier.

- Billing substrate is **Creem** (not Stripe as the original sketch
  suggested — repo has been on Creem since Phase 0). Phase 4 adapts
  the plan accordingly: per-run metering is stored locally
  (`workspace_operator_usage`) and can be wired to Creem usage events
  later without schema churn.
- Business tier added to `workspace_subscriptions.plan` CHECK
  constraint. `isProWorkspace` now covers both `pro` and `business`;
  new `isBusinessWorkspace` helper. `.env.example` documents
  `CREEM_BUSINESS_PRODUCT_ID`.
- Quotas per tier (`OPERATOR_TIER_LIMITS`):
  - **Free**: 5 runs/month per workspace (shared across members)
  - **Pro**: 50 runs/month per user
  - **Business**: 500 runs/month per user
  - Admins bypass via `ADMIN_EMAILS` (shared with `requireAdmin.ts`)
  - Per-workspace override via new `override_operator_quota` column on
    `workspace_subscriptions`, toggled from admin UI
  - `resetsAt` = first of next month UTC
- `workspace_operator_quota_service.checkOperatorQuota({ userId,
  workspaceId })` — checked at the top of every operator action
  before `createOperatorRun`, so denied runs leave no row and cannot
  double-charge.
- `workspace_operator_usage` table — monthly rollup per
  `(workspace_id, user_id, month)` with `run_count`, `tool_call_count`,
  `input_token_count`, `output_token_count`, `estimated_cost_cents`.
  Service-role writes only; members can SELECT.
- Cost model: hardcoded per-model rates (gpt-4.1-mini at $0.4/M input
  / $1.6/M output, gpt-4.1 at $2/M / $8/M, fallback to mini). Rounded
  up to cents.
- Prompt-cache tuning:
  - `CONTEXT_VERSION` string + `_build_workspace_context_block` helper
    produces a byte-deterministic workspace context suffix appended
    after `SYSTEM_PROMPT`, so the combined prefix is identical across
    runs in the same workspace → qualifies for OpenAI auto-cache.
  - New `/api/agent/tools/workspace_context` endpoint exposes a
    deterministic workspace summary (alphabetically sorted boxes) to
    the agent when we want richer context.
  - Token usage capture — `Runner.run`'s `RunResult.context_wrapper.
    usage` (confirmed in SDK source) surfaces
    `input_tokens`/`output_tokens` and cached-token counts via
    `input_tokens_details.cached_tokens`. These flow into
    `OperatorResult` → `workspace_operator_runs` (new columns) →
    `workspace_operator_usage` rollup → billing UI.
- Billing UI: new "Workspace Operator usage" subsection under
  BillingSection — runs this month, tool calls, total tokens,
  estimated cost. Shows `X / Y` when a tier limit applies, `Unlimited`
  otherwise.
- Operator panel: new `quota_exceeded` phase — preloads quota on
  mount, disables Run button at limit, renders a panel with reset
  date + "Upgrade plan" CTA (hidden for business tier).
- Admin: new `/admin/operator_usage` page sorted by estimated cost
  desc; per-workspace quota override toggle on the subscriptions
  admin table; Business plan row + stat card.
- 56 new vitest cases (955/955 passing), 13 new pytest cases (79/80
  passing — same Phase 1 cite-guardrail false-positive).

Not yet: Creem metered-event sync, design partner onboarding, public
launch demo (these are product/biz rather than code tasks).

## Operational notes

### Concurrency sizing

Modal function decorators (see `agent/src/workspace_operator/app.py`):
- `min_containers=1` — always warm for responsiveness
- `max_containers=10`, `@modal.concurrent(max_inputs=10)` — 100
  theoretical concurrent runs, matched to OpenAI Tier 4 rate limits
- `scaledown_window=120` — 2 min idle before teardown
- `timeout=600` — 10 min hard kill

Bump `max_containers` + `max_inputs` linearly as OpenAI tier grows.
Cost is dominated by LLM tokens, not Modal containers.

### Rotating the shared secret

1. Generate a new random secret (≥32 chars).
2. Update `WORKSPACE_OPERATOR_SHARED_SECRET` in the Next.js env.
3. `modal secret create poggle-operator-secrets …` with the new value.
4. Redeploy both Next.js and the Modal app in that order.

### Known gaps

- [x] Runs table — ~~currently only audit events record Operator runs;
  no first-class history UI~~ Phase 3 added `workspace_operator_runs`
  table + `/app/agents/runs` history page
- [x] Streaming — ~~Modal endpoint is synchronous POST/response~~ Phase 2
  added progress callbacks via `/api/agent/tools/progress` + Supabase
  Realtime broadcast. Still synchronous dispatch (action blocks until
  completion) but UI receives live updates via broadcast channel.
- [x] Cost accounting — ~~no per-run token cost capture yet~~ Phase 4
  wires `RunResult.context_wrapper.usage` into `workspace_operator_runs`
  + `workspace_operator_usage` rollup + billing UI. Cost model is
  hardcoded; Creem metered-event sync is the next billing step.
- [x] Operator panel wired into the app layout —
  `OperatorPanelTrigger` (client wrapper, owns `open` state) replaces
  the raw `<GlobalSearch>` mount in `src/app/app/layout.tsx`. Desktop
  toolbar only — mobile parity is a follow-up (the desktop-only mount
  predates Phase 4, since `GlobalSearch` was already gated behind
  `md:flex`).
- [ ] No end-to-end smoke test against a deployed Modal endpoint.
  `agent/DEPLOY.md` documents the deploy + smoke procedure
  (`agent/scripts/deploy_staging.sh`, `agent/scripts/smoke_test.sh`);
  needs to be executed once against a real Modal account.
- [ ] `must_cite_per_claim` guardrail — pure-Python overhead measured
  at <0.1ms (`agent/scripts/bench_guardrail_latency.py` mocked mode).
  Real cost is the extra `gpt-4.1-mini` round-trip (~300–1500ms,
  ~5–10% latency tax on a full run). Recommendation: keep opt-in via
  `user_agent_preferences` for Pro/Business, do not enable for Free.
- [ ] `fetch_workspace_context` — framework overhead <1ms
  (`agent/scripts/bench_workspace_context.py` mocked mode, 40 boxes).
  Real cost is HTTP RTT (30–150ms). Recommendation: enable behind a
  settings flag once cache-hit-rate telemetry confirms the benefit
  beats per-run RTT.
- [ ] Activity feed broadcast is best-effort only (fire-and-forget POST
  + Realtime); no replay if the broadcast lands while no client is
  subscribed. Audit row is durable, but UI must reload to see history.
- [ ] Creem metered-event sync — Phase 4 stores usage locally but does
  not emit metered billing events to Creem. Add once Creem exposes an
  API for per-workspace usage reporting.
- [ ] Design partner onboarding + public launch demo ("Write a
  competitive brief in 90 seconds") — product/biz work, not code.
