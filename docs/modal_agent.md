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

### ⏳ Phase 2 — Plan-approve-execute UI

- Command bar (⌘K) invocation anywhere in the app
- Dockable agent panel (plan, live tool calls, progress, final result)
- Plan phase: agent drafts a 3–7 step plan, user approves or edits
  before execute
- Branch diff review banner: "Reviewed by agent" + accept-per-change
- Modal deployed to staging with `min_containers=1`
- Supabase Realtime channel for live tool-call streaming to browser

### ⏳ Phase 3 — Tool completion + governance

- Tools: `read_note`, `edit_note`, `link_notes`, `apply_template`,
  `web_fetch`
- Guardrails: must-cite per claim (model-based), max tool calls per run,
  branch-scope enforcement tests
- OpenAI Agents SDK tracing piped into activity feed
- Per-user `user_agent_preferences` (tone, citation style, tool allowlist)
- Per-workspace `workspace_operator_runs` table for history + replay

### ⏳ Phase 4 — Billing + launch

- Stripe metered billing keyed on run count
- Rate limiter: quota per tier (Free 5/mo, Pro 50/user/mo, Business
  500/user/mo)
- Prompt-cache tuning (OpenAI auto-caching relies on byte-identical
  prefixes — enforce invariant that workspace context appears after
  stable system prompt)
- 20 design partner teams onboarded
- Public launch demo: "Write a competitive brief in 90 seconds"

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

- [ ] Runs table — currently only audit events record Operator runs; no
  first-class history UI
- [ ] Streaming — Modal endpoint is synchronous POST/response. Phase 2
  moves to SSE or realtime channel so users see progress
- [ ] Cost accounting — no per-run token cost capture yet. Needed for
  Phase 4 billing
- [ ] No end-to-end smoke test against a deployed Modal endpoint. Phase
  2 adds one as part of the staging deploy checklist
