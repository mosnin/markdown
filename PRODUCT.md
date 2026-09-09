# Poggle — Product Vision & Architecture

## What Poggle Is

Poggle is the **shared memory for coding agents.**

Agents log what they are doing, in real time, as they do it. The next agent —
different tool, different account, different machine, hours later — picks up
with everything the last one knew.

Not a note-taking app. Not a knowledge base. Not a place humans curate content
for agents to read. Poggle is **infrastructure that agents write to
automatically, through hooks, and read from automatically, at session start.**

---

## The Problem We Solve

You are running several coding agents against one repo. Claude Code on one
plan. Codex on another. Maybe Cursor open in a third window, maybe a teammate's
session on the same branch.

Three hours in, one of them hits a usage cap.

You switch to the next one. And it knows **nothing**. Not what the goal was.
Not which approach already failed twice. Not that the migration was written but
never run. Not that the retry middleware is half-applied in a file it has not
opened. Not that the last agent already decided, with good reason, not to do
the obvious thing you are about to watch it do again.

So you spend the first twenty minutes of every fresh session re-explaining a
problem you already explained, badly, from memory — and the agent still redoes
work that was already done and re-walks paths that were already ruled out.

**The context died with the session.** Every time.

Existing tools do not solve this:

- **CLAUDE.md / AGENTS.md** — static, hand-maintained, describes the repo but
  not what is happening in it right now. Nobody updates it mid-task.
- **The agent's own context window** — dies with the process, and is compacted
  away long before that.
- **`--continue` / `--resume`** — same tool, same account, same machine. Useless
  the moment you switch to a different plan or a different agent.
- **Session transcripts on disk** — per-tool, unshared, unstructured, and far
  too large to hand to a fresh agent.
- **Telling the next agent yourself** — you are the bottleneck, and you forget.

Poggle makes the context outlive the session that produced it.

---

## The Loop

```
   ┌──────────────┐
   │  CAPTURE     │  Hooks fire inside the agent's own process.
   │              │  Prompts, edits, commands, test runs, commits,
   │              │  decisions, blockers, caps — logged as they happen.
   └──────┬───────┘
          ↓
   ┌──────────────┐
   │  DISTIL      │  Events roll up into checkpoints: the goal, what is
   │              │  done, what is in flight, what is blocked, what was
   │              │  decided, what is next.
   └──────┬───────┘
          ↓
   ┌──────────────┐
   │  SERVE       │  The next agent's SessionStart hook fetches a
   │              │  token-budgeted handoff brief and injects it into
   │              │  context. Before it reads a single file.
   └──────┬───────┘
          ↓
   ┌──────────────┐
   │  FAN OUT     │  Realtime stream for the dashboard. Webhooks for
   │              │  everything else — including "an agent just capped".
   └──────────────┘
```

---

## Core Concepts

### Projects
The unit context relays around — nearly always a repository. Sessions from a
laptop, a CI runner, and a teammate's machine all land on one project, because
the slug is derived from the git remote rather than the directory name.

### Sessions
One run of one agent. Carries the two facts that make the relay legible:
`account_label` (which plan burned the tokens) and `end_reason`.

`usage_capped` is a first-class outcome, not an error. It is the strongest
signal in the system: this work is unfinished and a handoff is imminent.

### Events
The append-only log. Every event carries a short `summary` — the line the next
agent actually reads — plus the full structured `payload`, the files it touched,
and a **salience** score from 0 to 5.

Salience is the product's central opinion: a decision made an hour ago outranks
a file read a minute ago. `file_read` is 0. `decision`, `blocker` and
`usage_limit` are 5. This is what makes a small brief useful instead of merely
short.

### Checkpoints
Distilled state over a range of events: goal, done, in flight, blocked,
decisions, next steps, open questions. One checkpoint replaces the two hundred
events it summarises, which is what makes briefs cheap.

The hook shims force a checkpoint at the two moments context is otherwise lost
forever: just before the agent compacts its own context, and as the run ends or
is cut off.

### Handoff Briefs
The output. A deterministic, token-budgeted markdown document assembled from
prior sessions, spent in priority order:

1. **Why the last session stopped.** A cap means unfinished, not done.
2. **What is blocked, and what was already tried and failed.** Re-running a
   failing approach is the most expensive mistake a fresh agent makes.
3. **Decisions already taken.** Re-litigating them silently diverges the work.
4. **What was in flight.** Half-applied edits, a migration written but not run.
5. **What to do next.**
6. **The timeline**, as evidence for all of the above.
7. **Files touched** — last, because an agent can always read the repo, but it
   cannot recover a decision nobody wrote down.

No model call. The same log and the same budget produce the same brief, byte for
byte. A brief you cannot reproduce is a brief you cannot debug, and an agent
that gets a different story on each reconnect is worse off than one that gets
none.

### Hooks
How capture happens without anyone remembering to do it.

- **Claude Code** — `SessionStart`, `UserPromptSubmit`, `PostToolUse`,
  `PreCompact`, `SessionEnd`. `SessionStart` is the one that matters: it returns
  the brief as `additionalContext`, so a fresh agent starts already knowing.
- **Codex CLI** — via its notify hook.
- **Git** — `post-commit`, so commits land in the log even with no agent running.
- **Generic HTTP + CLI** — one documented endpoint and a zero-dependency CLI, for
  Cursor, custom harnesses, and CI.

### Webhooks
Outbound, HMAC-signed, retried. `session.capped` is the one teams wire to Slack:
*"Claude Code on plan A just capped mid-task — here is the brief for whoever
picks it up."*

---

## Design Principles

1. **Never block the agent.** Hooks run inline in the agent's process. Every
   call is timeout-bounded and every failure is swallowed. A relay outage must
   be invisible to the person coding; the worst acceptable outcome is a missing
   log entry.

2. **Never lose the last five minutes.** Events spool to disk before they are
   sent and flush on the next invocation. The single most important moment to
   capture — an agent being killed by a usage cap — is exactly the moment its
   in-flight request dies with it.

3. **Capture is automatic; curation is optional.** If using Poggle requires
   discipline, it will not be used at the moment it matters, because that moment
   is always mid-task and under pressure.

4. **The log is append-only.** No UI path rewrites history. The only mutation is
   redaction, which is separate and audited. If you want to change what the log
   says, add to it.

5. **Redact twice.** Agent event payloads are the most secret-dense data this
   product will ever hold — a `PostToolUse` hook can carry a `.env` file or an
   `export AWS_SECRET=…` line. Scrub on the client so the secret never leaves the
   machine, scrub again on the server because the client is code we do not
   control once installed.

6. **Deterministic beats clever.** The brief assembler is pure logic over a
   priority order. Model-written prose belongs upstream, in checkpoint
   distillation, where its output is stored and auditable.

---

## The Stack

```
┌─────────────────────────────────────────────────────┐
│                    DASHBOARD                         │
│    Live timeline · Sessions · Briefs · Relay chain   │
├─────────────────────────────────────────────────────┤
│              HANDOFF BRIEF ASSEMBLER                 │
│      Deterministic · Token-budgeted · Prioritised    │
├─────────────────────────────────────────────────────┤
│           CHECKPOINTS  ·  SESSION EVENTS             │
│         Append-only · Salience-scored · Realtime     │
├─────────────────────────────────────────────────────┤
│                  INGEST + RELAY API                  │
│      Idempotent · Batched · Spooled · Redacted       │
├─────────────────────────────────────────────────────┤
│      HOOKS          MCP          WEBHOOKS            │
│  Claude Code    any agent    Slack / CI / anything   │
│  Codex · git                                         │
└─────────────────────────────────────────────────────┘
```

---

## What Poggle Is NOT

- Not a note-taking app, or a knowledge base for humans (Notion, Confluence)
- Not a static instructions file (CLAUDE.md, AGENTS.md, `.cursorrules`)
- Not a vector database or a RAG pipeline
- Not agent memory inside one runtime (Letta, MemGPT, `--resume`)
- Not an observability or eval product — we optimise for *the next agent reading
  this*, not for dashboards about token spend

Poggle is the layer that makes a fresh agent start where the last one stopped.

---

## Migration status

This document describes the product as of the pivot away from Context Store
(boxes / notes / proposals / workflows). The relay core — schema, ingest, brief
assembly, hooks CLI, MCP tools — is built and tested. The previous product's
surface still exists in the codebase and is being removed; see
`docs/agent_context_relay_v1.md` for what has landed and what has not.
