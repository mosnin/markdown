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

---

## The conversation layer (v1.1)

The event log records what agents **concluded**. This records what they
**said**. Both are needed: a conclusion routes the next agent, but only the
conversation explains why three approaches were abandoned — and that is the
expensive thing to rediscover.

Claude Code hands us `transcript_path` on every hook invocation. v1 ignored it.

### The storage rule

> **Preserve what cannot be reconstructed. Drop what can.**

An assistant's reasoning ("I tried the replay assertion, it fails because test
mode dedupes within 60s") exists nowhere else once the process exits. A file's
contents, a grep result, an `ls` — all re-derivable in one tool call. So:

| Kind | Policy | Salience |
|---|---|---|
| `prompt` | verbatim | 4 |
| `reasoning` (incl. extended thinking) | verbatim, split not truncated | 4 |
| `summary` (compaction) | verbatim | 5 |
| `tool_call` | args only | 2 |
| `tool_result` | head 1200 + tail 800 chars | 1, or **4 if it errored** |

The error promotion matters: a failing result is the *evidence* for a dead end,
so it is worth as much as the reasoning that cites it.

Measured on a realistic transcript: **36,882 bytes → 2,357 stored (93.6%
reduction)**, with the rejected approach, the failing test name, and the
assertion message all intact.

### Schema — `20260909000002_session_transcripts.sql`

| Table | Purpose |
|---|---|
| `session_transcripts` | One per session. Chiefly a byte cursor (`last_ingested_offset`) — what makes ingest incremental. |
| `transcript_segments` | The retrieval unit. Dense `ordinal` per transcript, generated `fts` tsvector, GIN + salience indexes. |
| `transcript_segment_embeddings` | Optional `vector(1536)`, ivfflat, populated asynchronously. |

Segments live in Postgres rather than object storage because they *are* the
retrieval unit — every search result is a segment, so putting bodies behind an
object fetch would add a round trip to the hot path and take them out of reach
of FTS and pgvector. `raw_storage_path` is reserved for archiving the untouched
original, which is a fidelity concern rather than a retrieval one.

### Incremental shipping

A live transcript is a file being appended to. The client sends bytes after a
cursor; the server parses complete lines only and returns `next_offset`.

The subtle part, and the one that had a real bug caught by its own test:
`"a\nb\n".split("\n")` yields a trailing empty element. Counting it advanced
the cursor one byte past the end and silently ate the first character of the
next chunk. Byte offsets, never character offsets — a character cursor drifts on
any non-ASCII transcript.

**When we ship** matters as much as what. Shipping only at `PreCompact` and
`SessionEnd` would lose exactly the session this product exists for: a hard
usage cap kills the process mid-tool-call and neither hook fires. So the shim
also ships opportunistically once 32KB has accumulated, bounding worst-case loss
to ~32KB instead of the whole session.

### Retrieval — hybrid, and why

`searchTranscripts` runs both indexes and merges:

- **Keyword (FTS)** catches exact identifiers — a function name, an error code,
  a file path. This is what agents most often search for and what embeddings are
  worst at.
- **Vector** catches the paraphrase: "why did the retry approach fail" finds
  reasoning that never uses the word "retry".
- **Both** ranks highest — agreement between independent signals.

Vector similarity is blended 0.85/0.15 with salience in the SQL, so a
half-relevant piece of reasoning outranks a perfectly-matching directory listing.

Embeddings are generated by a cron (`/api/internal/relay_embed`), never inline:
ingest is on a hook's hot path and must not wait on a third-party API. Search
works on keyword the instant a segment lands and improves when the backfill
catches up. **A deployment with no `EMBEDDING_API_KEY` has working search, not
broken search.** Only segments at importance ≥ 2 are embedded — embedding every
`ls` would cost money to make search worse.

### Progressive disclosure

The brief does not grow. It gains a pointer section saying how much
conversation exists and how to query it, placed *after* the distilled
sections — a pointer is worthless if it displaces the substance.

| Surface | Question it answers |
|---|---|
| Handoff brief | "What do I need to know before I start?" (unprompted, budgeted) |
| `search_agent_history` | "Did anyone try X? Why is Y this way?" (on demand) |
| `read_transcript_window` | "Show me that exchange in context" (after a hit) |

### API additions

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/relay/transcripts` | Ship a chunk; returns `next_offset` |
| GET | `/api/v1/relay/transcripts/{session_id}` | Read a window (`around`, `radius`) |
| GET | `/api/v1/relay/search` | Hybrid search over conversation and events |
| POST | `/api/internal/relay_embed` | Cron embedding backfill |

---

## Relay keys

`src/server/services/relay_key_service.ts`, `/app/settings/relay_keys`

The credential a hook carries, and the one thing standing between a fresh
install and a working relay. Stored as a `connections` row of type `agent_hook`
plus a `connection_tokens` row, reusing the existing prefix-and-sha256 storage.

Deliberately a separate service from `connection_service` rather than a flag on
it, because they differ in every way that matters: no box scopes (a relay key
reaches the session log and nothing else), no connected-agent quota (that cap
counts legacy csk_v1_ connections and was sized for a different product — a flat
ceiling of 25 live keys per workspace guards against runaway creation instead),
and a different expiry posture.

**Expiry defaults to none**, which departs from the connection tokens this
reuses. A hook key that silently expires mid-session does not fail loudly — it
fails as an empty handoff brief three weeks later, when somebody needed context
and there was none, with no obvious cause. That is worse than a long-lived
credential whose blast radius is append-only writes to one workspace's log.
Revocation is the control, `last_used_at` makes a forgotten key visible, and
callers wanting a bounded credential pass `expiresAt` explicitly.

**Rotation revokes immediately**, with no overlap window: an unattended shim
cannot be asked to migrate gracefully, so a clean cut plus "paste this into the
machine again" is more honest than a grace period nobody acts on.

The reveal panel hands over the exact shell command rather than the bare secret,
because the job of that screen is not "manage credentials" — it is to get a
working key onto a developer's machine in the fewest steps. A key that has never
been used is badged in the listing, since a config that never landed on the
machine is otherwise a silent failure.

---

## What is NOT built yet

Being honest about the gap, in rough priority order:

1. **UI.** No dashboard for projects, the live timeline, sessions, or briefs.
   The API and SSE stream are there; nothing renders them. This is the largest
   remaining piece.
2. ~~**Relay key management.**~~ Shipped — see "Relay keys" below.
3. **Checkpoint distillation.** Checkpoints are only written when an agent or
   hook explicitly writes one. The automatic rollup — summarising N events into
   a checkpoint with a model — is not built, so briefs currently lean on raw
   salient events for sessions that never checkpointed. With transcripts now
   stored, the natural implementation is to distil from segments rather than
   events: the reasoning is there in full.
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
8. **Hook schema verification.** The Claude Code hook payload,
   `transcript_path`, and `additionalContext` shapes in `cli/poggle.mjs` were
   written against the documented contract and have not been run against a live
   agent. The shim is defensive — an unrecognised payload degrades to a generic
   event, an unreadable transcript is skipped — but the injection and transcript
   paths need an end-to-end test against a real session.

9. **Transcript retention.** Segments accumulate without bound. They need a
   retention policy and, past a few million rows, partitioning by `created_at`
   the same way `session_events` will.

10. **Raw archive.** `session_transcripts.raw_storage_path` is reserved but not
    populated: the untouched original is not kept, so the 93.6% we drop at
    ingest is dropped for good. Fine for retrieval, wrong for export.

## Tests

`src/tests/unit/session_event_redaction.test.ts` — 15 cases covering credential
shapes, structure preservation, and termination on hostile input.
`src/tests/unit/handoff_brief_service.test.ts` — priority ordering, budget
adherence, determinism, cross-workspace refusal, requesting-session exclusion.
`src/tests/unit/relay_ingest_normalisation.test.ts` — slug derivation across
every way of naming one repo, end-reason coercion, salience defaults.
`src/tests/unit/relay_key_service.test.ts` — 16 cases: the raw secret never
reaches storage, a minted token round-trips to the hash verification will
compute, rotation leaves exactly one live secret, cross-workspace access
refused.
`src/tests/unit/transcript_parser.test.ts` — 20 cases: reasoning kept whole,
tool output truncated head-and-tail, error results promoted, partial trailing
lines left unconsumed, byte-accurate offsets on multi-byte text, one malformed
line costing only itself.

Not covered: the RPC's concurrency behaviour (needs a live Postgres), the SSE
route, and the CLI.
