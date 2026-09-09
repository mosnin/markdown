# Agent Context Relay v1

The pivot from Context Store (boxes / notes / proposals / workflows) to Poggle
as **shared memory for coding agents**. See `PRODUCT.md` for the product
argument; this document is the engineering record: what landed, how it works,
and what has not been built yet.

---

## The scenario this is designed around

1. Claude Code, on plan A, works for three hours on `feat/idempotent-charges`.
   Its hooks log prompts, edits, commands, test runs, and two decisions.
2. It hits a usage cap. The process is killed mid-tool-call. Its `SessionEnd`
   hook may not fire at all.
3. You open Codex on plan B, same repo.
4. Codex's `SessionStart` hook calls `GET /api/v1/relay/handoff`. The response
   is injected into its context before it reads a single file.
5. Codex starts knowing the goal, that the Stripe replay test approach was
   already ruled out, that the retry middleware is half-written, and that
   charges are keyed on `(merchant_id, request_id)` by deliberate choice.

Every design decision below serves some step of that sequence.

---

## Data model

`supabase/migrations/20260909000001_agent_context_relay.sql`

| Table | Purpose |
|---|---|
| `projects` | The unit context relays around. Slug derived from the git remote so a laptop, a CI runner, and a teammate's clone land on one project. |
| `agent_sessions` | One run of one agent. Carries `account_label` (which plan burned the tokens) and `end_reason` (`usage_capped` is first-class). `resumed_from_session_id` is the relay edge. |
| `session_events` | Append-only log. `summary` is what a brief carries; `payload` is the detail. `importance` 0–5 is the salience score the assembler sorts on. |
| `session_checkpoints` | Distilled state over a sequence range: goal, done, in_flight, blocked, decisions, next_steps, files_touched, open_questions. |
| `handoff_briefs` | Materialised briefs — the audit trail of what context crossed between accounts. |

### `append_session_events(session_id, events)`

One `SECURITY DEFINER` function does the whole write, under a row lock on the
session:

1. Locks the session — serialises sequence allocation across concurrent hooks.
2. Skips events whose `client_event_id` was already accepted.
3. Assigns sequences from `event_count + 1`.
4. Advances `event_count`, `last_seen_at`, and the usage counters.

It returns only the rows it actually inserted, so a replayed batch fans out to
zero webhooks. Duplicates do not consume a sequence number, which keeps the log
gap-free.

### RLS

Reads are workspace-member-scoped through the existing `owns_workspace()`
helper. There is deliberately **no insert or update policy for `authenticated`
on `session_events`**: events arrive from machine tokens through the service
role, and no UI path may rewrite history. Projects are the exception — humans
create and rename those.

---

## Ingest

`src/server/services/session_ingest_service.ts`

Three properties, in priority order:

1. **Do not block the agent.** Hooks run inline in the agent's process. Webhook
   fan-out is fire-and-forget and never awaited.
2. **Be idempotent.** Hooks retry from an on-disk spool after the process was
   killed — which is precisely the case we exist to serve.
3. **Do not lose an event to a validation quibble.** Unknown event types degrade
   to `custom`; unparseable importance degrades to the type's default. A partial
   log beats no log.

The one hard limit is payload size (64KB): a 4MB stdout dump per tool call would
make the log useless and expensive at once, so oversized payloads are replaced
with a marker.

### Redaction

`src/server/services/session_event_redaction.ts` — scrubs on the way in, on top
of the client-side pass in the CLI. Two passes because the client is code we do
not control once installed: an old shim, a custom integration, or a curl
one-liner will send raw text.

Covers bearer tokens, this product's own relay keys, GitHub / Anthropic /
OpenAI / AWS / Slack credentials, JWTs, connection-string credentials,
`SECRET=`-style shell assignments, and PEM private key blocks. Sensitive object
keys (`password`, `*_token`, `authorization`, …) are blanked regardless of the
value's shape. Depth-, node-, and length-capped so hostile input terminates.

---

## Handoff brief assembly

`src/server/services/handoff_brief_service.ts`

**Deterministic — no model call.** Same log plus same budget produces the same
brief byte for byte. A brief you cannot reproduce is one you cannot debug, and
an agent that gets a different story on each reconnect is worse off than one
that gets none. Model-written prose belongs upstream in checkpoint distillation,
where its output is stored and auditable.

**Budgeted in priority order.** Blocks are emitted cheapest-to-lose-last:

| Priority | Section | Why it ranks here |
|---|---|---|
| 0 | Header + why the last session stopped | A cap means unfinished, not done |
| 10 | Goal | Everything else is unreadable without it |
| 20 | Blocked / already tried and failed | Re-running a failed approach is the most expensive mistake a fresh agent makes |
| 30 | Open questions | |
| 40 | Decisions already made | Re-litigating them silently diverges the work |
| 50 | In flight | Half-applied edits are invisible in a clean-looking repo |
| 60 | Next steps | |
| 70 | Already done | |
| 80+ | Per-session log | Evidence for the above |
| 200 | Files touched | An agent can read the repo; it cannot recover a decision nobody wrote down |

Blocks are all-or-nothing — half a "Decisions" list reads as if it were
complete. When a block is skipped the assembler keeps going, because a later
block may still fit, and the footer says how many were dropped.

Checkpoints are preferred over raw events; salient events are only fetched for
sessions whose checkpoint has fallen behind the log.

---

## API

All under `/api/v1/relay`. Auth is a relay key or an OAuth token with the new
`relay:read` / `relay:write` scopes.

| Method | Path | Purpose |
|---|---|---|
| POST | `/sessions` | Open or resume a session (idempotent on project + external_id) |
| GET | `/sessions?project=` | List sessions; marks stale ones idle |
| GET | `/sessions/{id}` | One session plus a page of its events |
| PATCH | `/sessions/{id}` | `{action:"heartbeat"}` or `{action:"end", end_reason}` |
| POST | `/events` | Batch append. Accepts `session_id` **or** an inline `session` descriptor so one request can open-and-log |
| POST | `/checkpoints` | Write distilled state |
| GET | `/handoff?project=&budget=` | The brief. `format=markdown` returns raw text for piping into an agent |
| GET | `/stream?project=` | SSE: backfill then live events across every session on the project |

### Auth

`src/server/auth/relay_auth.ts`. Hooks cannot complete an OAuth browser dance at
the moment they need to log an event, so the relay accepts a second token
family: `pgr_v1_<64hex>` relay keys, stored like connection tokens (prefix for
lookup, sha256 for verification) under a connection of type `agent_hook`.

Resolved here rather than through the deprecated `csk_v1_` path, which is
env-gated off in production and should stay that way. A relay key can append to
the log and read briefs and can do nothing else; the log is append-only at the
database level, so a leaked key cannot rewrite history.

---

## Hooks (`cli/poggle.mjs`)

Zero dependencies, Node 18+. It has to run before `npm install`, in a fresh
container, on whatever Node the user has.

```
poggle init                     install hooks into this repo
poggle brief [--budget N]       print the handoff brief
poggle log <type> <summary>     log one event
poggle checkpoint --summary S   write distilled state
poggle end [--reason R]         close the session
poggle status                   config + spool state
poggle hook <HookEventName>     internal: called by agent hooks
```

`poggle init` writes `.poggle.json`, merges hook entries into
`.claude/settings.json` (replacing only its own entries, leaving other hooks
alone), installs a `post-commit` git hook if none exists that it did not write,
and gitignores the spool.

**The `SessionStart` behaviour is the product**: it logs the start, fetches the
brief, and emits it as `hookSpecificOutput.additionalContext`, which the runtime
injects into the model's context.

**The spool is the second-most-important part.** Events are appended to
`.poggle/spool.jsonl` before being sent and flushed on the next invocation. The
single most important moment to capture — an agent killed by a usage cap — is
exactly the moment its in-flight HTTP request dies with it.

Every command exits 0. A hook that fails must not break somebody's agent.

---

## MCP

Three tools on the existing `/api/mcp` endpoint, for runtimes that speak MCP but
have no hooks: `get_handoff_brief`, `list_agent_sessions`, `log_agent_event`.
Their descriptions tell the model *when* to call them, since that is the part a
tool description actually has to earn.

## Webhooks

Reuses the existing HMAC-signed, retried delivery machinery. New event types:
`session.started`, `session.event` (firehose), `session.attention` (a
salience-5 event — a blocker or a cap), `session.ended`, `session.capped`.

`session.capped` is the one to wire to Slack.

---

## What is NOT built yet

Being honest about the gap, in rough priority order:

1. **UI.** No dashboard for projects, the live timeline, sessions, or briefs.
   The API and SSE stream are there; nothing renders them. This is the largest
   remaining piece.
2. **Relay key management.** `mintRelayToken()` exists and the auth path
   verifies keys, but there is no settings page to create one and no service
   that persists the `agent_hook` connection. Keys must currently be inserted by
   hand. **This blocks first real use** and is the smallest high-value gap.
3. **Checkpoint distillation.** Checkpoints are only written when an agent or
   hook explicitly writes one. The automatic rollup — summarising N events into
   a checkpoint with a model — is not built, so briefs currently lean on raw
   salient events for sessions that never checkpointed.
4. **Cap detection.** `usage_capped` must be reported by the client. Inferring a
   cap from an abrupt stop plus a provider error signature is not implemented.
5. **Codex hook wiring.** `poggle init` prints the `notify` line for
   `~/.codex/config.toml`; it does not write it, and Codex's notify payload is
   translated by the same Claude-Code-shaped path rather than its own.
6. **Demolition.** The Context Store surface (boxes, notes, CRDT editor,
   branches, proposals, workflows, knowledge graph, marketing site) is still in
   the repo. Roughly 60% of the app is now dead weight.
7. **Partitioning.** `session_events` is a plain table. It will need
   partitioning by `created_at`; follow the existing
   `internal/partition_maintenance` job.
8. **Hook schema verification.** The Claude Code hook payload and
   `additionalContext` shapes in `cli/poggle.mjs` were written against the
   documented contract and have not been run against a live agent. The shim is
   defensive — an unrecognised payload degrades to a generic event rather than
   throwing — but the injection path specifically needs an end-to-end test.

## Tests

`src/tests/unit/session_event_redaction.test.ts` — 15 cases covering credential
shapes, structure preservation, and termination on hostile input.
`src/tests/unit/handoff_brief_service.test.ts` — priority ordering, budget
adherence, determinism, cross-workspace refusal, requesting-session exclusion.
`src/tests/unit/relay_ingest_normalisation.test.ts` — slug derivation across
every way of naming one repo, end-reason coercion, salience defaults.

Not covered: the RPC's concurrency behaviour (needs a live Postgres), the SSE
route, and the CLI.
