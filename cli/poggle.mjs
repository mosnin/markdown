#!/usr/bin/env node
/**
 * Poggle relay CLI — the hook shim.
 *
 * This is the client half of the agent context relay. It runs inside an
 * agent's own process, as a hook, hundreds of times per session. Three rules
 * follow from that, and every design choice here serves them:
 *
 *   1. NEVER BLOCK THE AGENT. Every network call has a hard timeout. Every
 *      command exits 0 even when it fails. A relay outage must be invisible to
 *      the person coding; the worst acceptable outcome is a missing log entry.
 *
 *   2. NEVER LOSE AN EVENT TO A CRASH. Events are appended to an on-disk spool
 *      before they are sent, and the spool is flushed on the next invocation.
 *      This is not belt-and-braces: the single most important moment to
 *      capture — an agent being killed by a usage cap — is precisely the
 *      moment its in-flight HTTP request dies with it.
 *
 *   3. NO DEPENDENCIES. This has to run before `npm install`, inside a fresh
 *      container, on whatever Node the user has. Node 18+ for global fetch,
 *      nothing else.
 *
 * Commands:
 *   poggle init [--project <slug>]   install hooks into this repo
 *   poggle brief [--budget N]        print the handoff brief for this project
 *   poggle log <type> <summary>      log one event
 *   poggle checkpoint --summary S    write a distilled checkpoint
 *   poggle end [--reason R]          close the current session
 *   poggle checkin [--intent "..."]  check in: peers, claims, conflicts
 *   poggle ship-transcript --path F  upload an agent transcript (incremental)
 *   poggle hook <HookEventName>      internal: called by an agent hook, JSON on stdin
 *   poggle status                    show config and spool state
 *
 * Configuration, in precedence order:
 *   env POGGLE_API_URL / POGGLE_TOKEN / POGGLE_PROJECT
 *   ./.poggle.json          (per repo, safe to commit — no secrets)
 *   ~/.poggle/config.json   (per machine, holds the token)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_API_URL = "https://poggle.xyz";
/** Hard cap on any request made from a hook. Tuned to be invisible to a human. */
const REQUEST_TIMEOUT_MS = 2500;
/** The brief is worth waiting a little longer for — it runs once, at startup. */
const BRIEF_TIMEOUT_MS = 8000;
/** Stop the spool from growing without bound if the relay is down for days. */
const MAX_SPOOL_EVENTS = 2000;

/**
 * Transcript shipping.
 *
 * MAX_TRANSCRIPT_CHUNK matches the server's per-request ceiling; a bigger
 * backlog is sent as several chunks rather than rejected.
 *
 * TRANSCRIPT_FLUSH_BYTES is the one that matters. Shipping only at PreCompact
 * and SessionEnd would lose precisely the session we exist to save: a hard
 * usage cap kills the process mid-tool-call and neither hook ever fires. So we
 * also ship opportunistically once this much new transcript has accumulated,
 * which bounds worst-case loss to roughly this many bytes instead of the whole
 * session.
 */
const MAX_TRANSCRIPT_CHUNK = 3 * 1024 * 1024;
const TRANSCRIPT_FLUSH_BYTES = 32 * 1024;
/** Transcript uploads are bigger than events; give them proportionally longer. */
const TRANSCRIPT_TIMEOUT_MS = 15000;

/**
 * How often the hook checks in on the agent's behalf.
 *
 * Check-in is what keeps this agent visible to its peers and its claims alive.
 * Doing it on every tool call would be wasteful; doing it only at session start
 * would let claims lapse mid-session and make a working agent look dead to
 * everyone else. Four minutes is well inside the 15-minute claim TTL, so a
 * couple of missed check-ins still cost nothing.
 */
const CHECKIN_INTERVAL_MS = 4 * 60 * 1000;

// ─── Config ─────────────────────────────────────────────────────────────────

function homeConfigPath() {
  return path.join(os.homedir(), ".poggle", "config.json");
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function gitOutput(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Derive the project slug.
 *
 * Preference order matters: an explicit slug is authoritative, then the git
 * remote (stable across machines and clones, which is what makes sessions from
 * a laptop and a CI runner land on one project), then the directory name.
 */
function deriveProject(cwd, explicit) {
  if (explicit) return explicit;
  const remote = gitOutput(["config", "--get", "remote.origin.url"], cwd);
  if (remote) {
    const cleaned = remote
      .replace(/^git@([^:]+):/, "")
      .replace(/^[a-z]+:\/\/[^/]+\//i, "")
      .replace(/\.git$/, "");
    if (cleaned) return cleaned.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  }
  return path.basename(cwd).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function loadConfig(cwd) {
  const home = readJsonSafe(homeConfigPath());
  const repo = readJsonSafe(path.join(cwd, ".poggle.json"));

  const apiUrl =
    process.env.POGGLE_API_URL || repo.api_url || home.api_url || DEFAULT_API_URL;
  const token = process.env.POGGLE_TOKEN || home.token || "";
  const project = deriveProject(
    cwd,
    process.env.POGGLE_PROJECT || repo.project || ""
  );

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    token,
    project,
    projectName: repo.project_name || project,
    accountLabel:
      process.env.POGGLE_ACCOUNT || repo.account_label || home.account_label || "",
    cwd,
  };
}

// ─── Spool ──────────────────────────────────────────────────────────────────

function spoolDir(cwd) {
  return path.join(cwd, ".poggle");
}

function spoolPath(cwd) {
  return path.join(spoolDir(cwd), "spool.jsonl");
}

function sessionStatePath(cwd) {
  return path.join(spoolDir(cwd), "session.json");
}

function ensureSpoolDir(cwd) {
  try {
    fs.mkdirSync(spoolDir(cwd), { recursive: true });
  } catch {
    // Read-only checkout: we simply lose spooling, not the whole shim.
  }
}

/** Append events to the spool. Never throws. */
function spoolEvents(cwd, events) {
  try {
    ensureSpoolDir(cwd);
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(spoolPath(cwd), lines);
  } catch {
    // Nothing to do — an unspoolable event is simply dropped.
  }
}

/** Read and clear the spool. Returns the events it drained. */
function drainSpool(cwd) {
  const file = spoolPath(cwd);
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    fs.rmSync(file, { force: true });
    const events = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    // Under sustained outage, keep the newest: recent context is the useful kind.
    return events.slice(-MAX_SPOOL_EVENTS);
  } catch {
    return [];
  }
}

/** Remember the open session so later hook invocations can reuse it. */
function readSessionState(cwd) {
  return readJsonSafe(sessionStatePath(cwd));
}

function writeSessionState(cwd, state) {
  try {
    ensureSpoolDir(cwd);
    fs.writeFileSync(sessionStatePath(cwd), JSON.stringify(state, null, 2));
  } catch {
    // Falls back to re-opening the session by external_id, which is idempotent.
  }
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

/**
 * Make a request to the relay.
 *
 * Returns { ok, status, body } and never throws — a hook that throws is a hook
 * that breaks somebody's agent.
 */
async function apiRequest(config, method, pathname, body, timeoutMs) {
  if (!config.token) {
    return { ok: false, status: 0, body: null, error: "no token configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.apiUrl}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        "user-agent": "poggle-cli/1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The session descriptor sent with every batch, so ingest can open-or-resume. */
function sessionDescriptor(config, externalId, extra = {}) {
  return {
    project: config.project,
    project_name: config.projectName,
    repo_url: gitOutput(["config", "--get", "remote.origin.url"], config.cwd) || undefined,
    external_id: externalId,
    agent_tool: extra.agent_tool || process.env.POGGLE_AGENT_TOOL || "custom",
    agent_model: extra.agent_model || process.env.POGGLE_AGENT_MODEL || undefined,
    account_label: config.accountLabel || undefined,
    host: os.hostname(),
    cwd: config.cwd,
    git_branch: gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], config.cwd) || undefined,
    git_commit: gitOutput(["rev-parse", "--short", "HEAD"], config.cwd) || undefined,
    ...extra,
  };
}

/**
 * Send events, spooling first so a crash mid-request loses nothing.
 *
 * On success the spool is already drained. On failure the events are written
 * back so the next invocation retries them.
 */
async function sendEvents(config, externalId, events, sessionExtra = {}) {
  const spooled = drainSpool(config.cwd);
  const batch = [...spooled, ...events];
  if (batch.length === 0) return { ok: true, sent: 0 };

  const state = readSessionState(config.cwd);

  const payload = state.session_id
    ? { session_id: state.session_id, events: batch }
    : { session: sessionDescriptor(config, externalId, sessionExtra), events: batch };

  const result = await apiRequest(config, "POST", "/api/v1/relay/events", payload);

  if (!result.ok) {
    // A 404 means our remembered session id is stale (workspace reset, project
    // deleted). Drop it so the next attempt re-opens by external_id.
    if (result.status === 404 || result.status === 400) {
      writeSessionState(config.cwd, { ...state, session_id: undefined });
    }
    spoolEvents(config.cwd, batch);
    return { ok: false, sent: 0, error: result.error || `HTTP ${result.status}` };
  }

  const sessionId = result.body?.data?.session_id;
  if (sessionId && sessionId !== state.session_id) {
    writeSessionState(config.cwd, { ...state, session_id: sessionId, external_id: externalId });
  }

  return { ok: true, sent: batch.length };
}

// ─── Event construction ─────────────────────────────────────────────────────

function makeEvent(type, summary, extra = {}) {
  return {
    event_type: type,
    summary: String(summary ?? "").slice(0, 1900),
    client_event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Client-side redaction.
 *
 * The server scrubs again, but scrubbing here means a secret never leaves the
 * machine in the first place — which is the only version of this guarantee
 * that a security review will accept.
 */
function redact(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/\bBearer\s+[A-Za-z0-9_\-.=]+/gi, "Bearer <redacted>")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "<github-token>")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{16,}/g, "<anthropic-key>")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "<api-key>")
    .replace(/\bpgr_v1_[0-9a-f]{64}\b/g, "<relay-key>")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "<aws-access-key-id>")
    .replace(
      /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g,
      "$1=<redacted>"
    )
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s:/@]+@/gi, "$1<redacted>@");
}

// ─── Transcript shipping ────────────────────────────────────────────────────

/**
 * Read the bytes appended to a transcript since we last shipped it.
 *
 * Reads from a byte offset rather than loading the file: a long session's
 * transcript is megabytes, and this runs inside the agent's own process after
 * tool calls. Returns null when there is nothing new.
 */
function readTranscriptDelta(transcriptPath, offset, maxBytes) {
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size <= offset) return null;

    // The file shrank — a new session reused the path, or it was rotated.
    // Start over rather than reading from a meaningless offset.
    const start = stat.size < offset ? 0 : offset;
    const length = Math.min(stat.size - start, maxBytes);
    if (length <= 0) return null;

    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(transcriptPath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }

    return { start, text: buffer.toString("utf8"), fileSize: stat.size };
  } catch {
    // No transcript, no permission, a path that moved: all non-fatal.
    return null;
  }
}

/** Guess the transcript format from its path and first byte. */
function detectTranscriptFormat(transcriptPath, text) {
  if (/^\s*\{/.test(text)) {
    return transcriptPath.includes("codex") ? "codex_jsonl" : "claude_code_jsonl";
  }
  return "plain";
}

/**
 * Ship new transcript bytes to the relay.
 *
 * Offset tracking lives in .poggle/session.json, and the server is the
 * authority: we advance to whatever `next_offset` it reports, so a partial
 * line we sent is re-sent whole next time rather than being lost.
 */
async function shipTranscript(config, transcriptPath, options = {}) {
  if (!transcriptPath || !config.token) return { shipped: 0 };

  const state = readSessionState(config.cwd);
  if (!state.session_id) return { shipped: 0 };

  let offset = Number(state.transcript_offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const delta = readTranscriptDelta(transcriptPath, offset, MAX_TRANSCRIPT_CHUNK);
  if (!delta) return { shipped: 0 };

  // Opportunistic sends wait for a worthwhile batch; forced ones (a compaction
  // or the end of a session) always go.
  const pending = delta.fileSize - delta.start;
  if (!options.force && pending < TRANSCRIPT_FLUSH_BYTES) {
    return { shipped: 0 };
  }

  const result = await apiRequest(
    config,
    "POST",
    "/api/v1/relay/transcripts",
    {
      session_id: state.session_id,
      content: delta.text,
      format: detectTranscriptFormat(transcriptPath, delta.text),
      from_offset: delta.start,
    },
    TRANSCRIPT_TIMEOUT_MS
  );

  if (!result.ok) {
    // Leave the offset alone; the next invocation retries the same range.
    return { shipped: 0, error: result.error || `HTTP ${result.status}` };
  }

  const nextOffset = result.body?.data?.next_offset;
  if (typeof nextOffset === "number" && nextOffset >= 0) {
    writeSessionState(config.cwd, { ...state, transcript_offset: nextOffset });
  }

  return { shipped: result.body?.data?.segments_added ?? 0 };
}

// ─── Check-in ───────────────────────────────────────────────────────────────

/**
 * Check in with the relay on the agent's behalf.
 *
 * Renews claims, refreshes presence, and pulls back what other agents have done
 * since last time. Returns the check-in payload, or null when it could not run.
 */
async function performCheckIn(config, options = {}) {
  const state = readSessionState(config.cwd);
  if (!state.session_id || !config.token) return null;

  const result = await apiRequest(config, "POST", "/api/v1/relay/checkin", {
    session_id: state.session_id,
    intent: options.intent,
    claim: options.claim,
    release: options.release,
  });

  if (!result.ok) return null;

  writeSessionState(config.cwd, {
    ...readSessionState(config.cwd),
    last_checkin_ms: Date.now(),
  });

  return result.body?.data ?? null;
}

/**
 * Render a check-in into something worth interrupting an agent for.
 *
 * Only collision-shaped news qualifies. A running agent does not need a feed of
 * everything its peers are doing — it needs to know when somebody is in the
 * file it is editing, when a claim it wanted is taken, and when a peer asked a
 * question nobody has answered. Everything else is available on request.
 *
 * Returns null when there is nothing that warrants the interruption.
 */
function summariseCheckIn(checkin) {
  if (!checkin) return null;

  const lines = [];

  for (const conflict of checkin.conflicts ?? []) {
    lines.push(`- ${conflict.detail}`);
  }

  for (const notice of checkin.notices ?? []) {
    if (notice.importance >= 4) {
      lines.push(`- Notice from another agent: ${notice.body}`);
    }
  }

  for (const question of checkin.open_questions ?? []) {
    lines.push(`- Unanswered question from another agent: ${question.body}`);
  }

  if (lines.length === 0) return null;

  const peers = (checkin.peers ?? []).filter((p) => p.status === "active");
  const header =
    peers.length > 0
      ? `${peers.length} other agent${peers.length === 1 ? " is" : "s are"} working on this project right now.`
      : "Another agent has been working on this project.";

  return [
    "## Coordination update from Poggle",
    "",
    header,
    "",
    ...lines,
    "",
    "Re-read any file listed above before you change it — someone else has touched it since you last looked.",
  ].join("\n");
}

// ─── Agent hook translation ─────────────────────────────────────────────────

/**
 * Turn one Claude Code hook payload into relay events.
 *
 * The payload shape is the agent runtime's, not ours, so every field access is
 * defensive: an unrecognised or restructured payload degrades to a generic
 * event rather than throwing. Losing detail is acceptable; breaking somebody's
 * hook chain is not.
 */
function eventsFromClaudeCodeHook(hookName, payload) {
  const events = [];
  const toolName = payload.tool_name || payload.toolName;
  const toolInput = payload.tool_input || payload.toolInput || {};

  switch (hookName) {
    case "SessionStart":
      events.push(
        makeEvent("session_start", `Session started (${payload.source || "startup"})`, {
          importance: 3,
        })
      );
      break;

    case "UserPromptSubmit": {
      const prompt = redact(String(payload.prompt || "")).slice(0, 1000);
      events.push(
        makeEvent("prompt", prompt || "User sent a prompt", {
          actor: "user",
          importance: 4,
          payload: { full_prompt: prompt },
        })
      );
      break;
    }

    case "PreToolUse":
      // Pre-use is logged only for tools that change something. Logging every
      // read would bury the signal we care about under file-open noise.
      if (isMutatingTool(toolName)) {
        events.push(
          makeEvent("tool_call", `${toolName}: ${describeToolInput(toolName, toolInput)}`, {
            tool_name: toolName,
            files: filesFromToolInput(toolInput),
            importance: 2,
          })
        );
      }
      break;

    case "PostToolUse": {
      const response = payload.tool_response || payload.toolResponse || {};
      const failed =
        response?.success === false ||
        Boolean(response?.error) ||
        Boolean(response?.is_error);

      events.push(
        makeEvent(
          failed ? "tool_error" : classifyTool(toolName),
          `${toolName}: ${describeToolInput(toolName, toolInput)}${failed ? " — FAILED" : ""}`,
          {
            tool_name: toolName,
            files: filesFromToolInput(toolInput),
            importance: failed ? 4 : isMutatingTool(toolName) ? 3 : 1,
            payload: failed
              ? { error: redact(String(response?.error || response?.stderr || "")).slice(0, 2000) }
              : undefined,
          }
        )
      );
      break;
    }

    case "PreCompact":
      // The agent is about to forget. This is the highest-value moment in the
      // whole lifecycle to have written something down.
      events.push(
        makeEvent("compaction", "Agent context was compacted", { importance: 4 })
      );
      break;

    case "Stop":
    case "SessionEnd":
      events.push(
        makeEvent("session_end", `Session ended (${payload.reason || "stop"})`, {
          importance: 4,
        })
      );
      break;

    case "Notification":
      events.push(
        makeEvent("note", redact(String(payload.message || "Notification")).slice(0, 500), {
          actor: "system",
          importance: 2,
        })
      );
      break;

    default:
      events.push(
        makeEvent("custom", `${hookName} hook fired`, { actor: "hook", importance: 1 })
      );
  }

  return events;
}

const MUTATING_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

function isMutatingTool(toolName) {
  return MUTATING_TOOLS.has(toolName) || toolName === "Bash";
}

function classifyTool(toolName) {
  if (toolName === "Write") return "file_create";
  if (MUTATING_TOOLS.has(toolName)) return "file_edit";
  if (toolName === "Read") return "file_read";
  if (toolName === "Bash") return "command";
  return "tool_result";
}

function filesFromToolInput(input) {
  const file = input?.file_path || input?.filePath || input?.notebook_path;
  return file ? [String(file)] : [];
}

function describeToolInput(toolName, input) {
  if (toolName === "Bash") {
    return redact(String(input?.command || "")).slice(0, 300);
  }
  const file = input?.file_path || input?.filePath || input?.notebook_path;
  if (file) return String(file);
  if (input?.pattern) return `pattern ${String(input.pattern).slice(0, 120)}`;
  if (input?.description) return String(input.description).slice(0, 200);
  return "(no detail)";
}

/** Read all of stdin. Returns "" if nothing is piped in. */
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdBrief(config, args) {
  const budget = Number(getFlag(args, "--budget") || 4000);
  const query = new URLSearchParams({
    project: config.project,
    budget: String(budget),
    format: "markdown",
  });
  const state = readSessionState(config.cwd);
  if (state.session_id) query.set("session_id", state.session_id);

  const result = await apiRequest(
    config,
    "GET",
    `/api/v1/relay/handoff?${query.toString()}`,
    undefined,
    BRIEF_TIMEOUT_MS
  );

  if (!result.ok) {
    if (result.status === 404) {
      process.stdout.write(
        "No relay history for this project yet — you are the first session.\n"
      );
      return 0;
    }
    process.stderr.write(`poggle: could not fetch brief (${result.error || result.status})\n`);
    return 0;
  }

  process.stdout.write(typeof result.body === "string" ? result.body : String(result.body ?? ""));
  return 0;
}

async function cmdLog(config, args) {
  const [type, ...rest] = args;
  if (!type) {
    process.stderr.write("usage: poggle log <event_type> <summary>\n");
    return 1;
  }
  const summary = redact(rest.join(" ")) || type;
  const externalId = readSessionState(config.cwd).external_id || `cli-${randomUUID()}`;
  const result = await sendEvents(config, externalId, [makeEvent(type, summary)]);
  if (!result.ok) {
    process.stderr.write(`poggle: spooled for retry (${result.error})\n`);
  }
  return 0;
}

async function cmdCheckpoint(config, args) {
  const state = readSessionState(config.cwd);
  if (!state.session_id) {
    process.stderr.write("poggle: no active session to checkpoint\n");
    return 0;
  }

  const stdin = await readStdin();
  let body = {};
  if (stdin.trim()) {
    try {
      body = JSON.parse(stdin);
    } catch {
      body = { summary: stdin.trim() };
    }
  }

  const summary = redact(getFlag(args, "--summary") || body.summary || "");
  if (!summary) {
    process.stderr.write(
      'usage: poggle checkpoint --summary "..."  (or pipe JSON on stdin)\n'
    );
    return 1;
  }

  const result = await apiRequest(config, "POST", "/api/v1/relay/checkpoints", {
    session_id: state.session_id,
    kind: getFlag(args, "--kind") || body.kind || "manual",
    summary,
    state: body.state,
  });

  if (!result.ok) {
    process.stderr.write(`poggle: checkpoint failed (${result.error || result.status})\n`);
  }
  return 0;
}

async function cmdEnd(config, args) {
  const state = readSessionState(config.cwd);
  const reason = getFlag(args, "--reason") || "completed";

  // Flush anything spooled before we close, so the final moments are not lost.
  await sendEvents(config, state.external_id || `cli-${randomUUID()}`, []);

  if (state.session_id) {
    await apiRequest(config, "PATCH", `/api/v1/relay/sessions/${state.session_id}`, {
      action: "end",
      end_reason: reason,
    });
  }
  writeSessionState(config.cwd, {});
  return 0;
}

/**
 * The hook entry point. Called by an agent runtime with its payload on stdin.
 *
 * For SessionStart we do something special: after logging the start, we fetch
 * the handoff brief and emit it as `additionalContext`, which the agent runtime
 * injects into the model's context. That single behaviour is the whole product
 * from the user's point of view — a fresh agent that already knows what the
 * last one was doing.
 */
async function cmdHook(config, args) {
  const hookName = args[0] || "Unknown";
  const raw = await readStdin();

  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  // The runtime's own session id is the stable external id we key on.
  const externalId =
    payload.session_id ||
    payload.sessionId ||
    readSessionState(config.cwd).external_id ||
    `hook-${randomUUID()}`;

  const existing = readSessionState(config.cwd);
  if (existing.external_id !== externalId) {
    // A new agent run in this working copy: forget the old session id so we
    // open a fresh session rather than appending to the previous run's log.
    writeSessionState(config.cwd, { external_id: externalId });
  }

  const events = eventsFromClaudeCodeHook(hookName, payload);

  // Extra context to hand back to the runtime, if this hook supports it.
  const pendingContext = [];

  await sendEvents(config, externalId, events, {
    agent_tool: process.env.POGGLE_AGENT_TOOL || "claude_code",
    agent_model: payload.model || process.env.POGGLE_AGENT_MODEL || undefined,
  });

  // Ship the conversation itself. The runtime hands us the transcript path on
  // every hook invocation; without this the relay only ever learns what the
  // agent concluded, never what it actually said.
  //
  // Forced at PreCompact and at the end of a session — the two moments context
  // is otherwise lost for good — and opportunistic otherwise, because a hard
  // usage cap kills the process before either of those hooks can fire.
  const transcriptPath =
    payload.transcript_path || payload.transcriptPath || null;
  if (transcriptPath) {
    const force =
      hookName === "PreCompact" ||
      hookName === "SessionEnd" ||
      hookName === "Stop";
    await shipTranscript(config, transcriptPath, { force });
  }

  // Periodic check-in: keeps this agent visible to its peers, keeps its claims
  // alive, and pulls back collisions. Surfaced to the agent only when there is
  // something collision-shaped to say — a running agent does not need a feed of
  // everything its peers are doing.
  const checkinState = readSessionState(config.cwd);
  const sinceCheckIn = Date.now() - Number(checkinState.last_checkin_ms ?? 0);
  const forceCheckIn = hookName === "SessionStart" || hookName === "UserPromptSubmit";

  if (forceCheckIn || sinceCheckIn > CHECKIN_INTERVAL_MS) {
    const checkin = await performCheckIn(config);
    const update = summariseCheckIn(checkin);
    if (update) {
      // stderr is shown to the person running the agent and never parsed as
      // hook output, so this is safe regardless of which hook fired.
      process.stderr.write(`${update}\n`);
      pendingContext.push(update);
    }
  }

  if (hookName === "SessionStart") {
    const query = new URLSearchParams({
      project: config.project,
      budget: process.env.POGGLE_BRIEF_BUDGET || "4000",
      format: "markdown",
    });
    const state = readSessionState(config.cwd);
    if (state.session_id) query.set("session_id", state.session_id);

    const brief = await apiRequest(
      config,
      "GET",
      `/api/v1/relay/handoff?${query.toString()}`,
      undefined,
      BRIEF_TIMEOUT_MS
    );

    if (brief.ok && typeof brief.body === "string" && brief.body.trim()) {
      pendingContext.unshift(brief.body);
    }

    if (pendingContext.length > 0) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: pendingContext.join("\n\n---\n\n"),
          },
        })
      );
    }
  }

  if (hookName === "SessionEnd" || hookName === "Stop") {
    const state = readSessionState(config.cwd);
    if (state.session_id) {
      // `reason` comes from the runtime; anything we do not recognise is
      // normalised server-side to 'unknown' rather than guessed at here.
      await apiRequest(config, "PATCH", `/api/v1/relay/sessions/${state.session_id}`, {
        action: "end",
        end_reason: payload.reason || "completed",
      });
    }
  }

  return 0;
}

/**
 * Ship a transcript on demand.
 *
 * For agents that have no hook system: point this at the transcript file and
 * run it from a wrapper or a cron. Same incremental cursor as the hook path.
 */
async function cmdShipTranscript(config, args) {
  const transcriptPath = getFlag(args, "--path") || args[0];
  if (!transcriptPath) {
    process.stderr.write("usage: poggle ship-transcript --path <file>\n");
    return 1;
  }

  const result = await shipTranscript(config, transcriptPath, { force: true });
  if (result.error) {
    process.stderr.write(`poggle: transcript upload failed (${result.error})\n`);
    return 0;
  }
  process.stdout.write(`Shipped ${result.shipped} transcript segments.\n`);
  return 0;
}

/**
 * Check in from the command line.
 *
 * For a person driving an agent that has no hooks, or for a wrapper script that
 * wants to claim files before handing work to an agent.
 */
async function cmdCheckIn(config, args) {
  const intent = getFlag(args, "--intent") || undefined;
  const claimFlag = getFlag(args, "--claim");
  const releaseFlag = getFlag(args, "--release");

  const checkin = await performCheckIn(config, {
    intent,
    claim: claimFlag
      ? claimFlag.split(",").map((r) => ({ resource: r.trim(), intent }))
      : undefined,
    release: releaseFlag ? releaseFlag.split(",").map((r) => r.trim()) : undefined,
  });

  if (!checkin) {
    process.stderr.write("poggle: check-in failed (no session, or relay unreachable)\n");
    return 0;
  }

  const peers = (checkin.peers ?? []).filter((p) => p.status === "active");
  process.stdout.write(
    [
      `Checked in. ${peers.length} other active agent${peers.length === 1 ? "" : "s"}.`,
      ...peers.map(
        (p) =>
          `  ${p.agent_tool}${p.account_label ? ` (${p.account_label})` : ""}: ` +
          `${p.current_intent || "no stated intent"}` +
          `${p.claims.length ? ` — holding ${p.claims.join(", ")}` : ""}`
      ),
      ...((checkin.holding ?? []).length > 0
        ? [`You hold: ${(checkin.holding ?? []).map((h) => h.resource).join(", ")}`]
        : []),
      ...(checkin.conflicts ?? []).map((c) => `  ! ${c.detail}`),
      "",
    ].join("\n")
  );
  return 0;
}

function cmdStatus(config) {
  const state = readSessionState(config.cwd);
  const spool = fs.existsSync(spoolPath(config.cwd))
    ? fs.readFileSync(spoolPath(config.cwd), "utf8").split("\n").filter(Boolean).length
    : 0;

  process.stdout.write(
    [
      `api_url        ${config.apiUrl}`,
      `token          ${config.token ? `set (…${config.token.slice(-6)})` : "MISSING"}`,
      `project        ${config.project}`,
      `account_label  ${config.accountLabel || "(unset)"}`,
      `session_id     ${state.session_id || "(none open)"}`,
      `spooled events ${spool}`,
      `transcript     ${state.transcript_offset ? `${state.transcript_offset} bytes shipped` : "(none shipped)"}`,
      "",
    ].join("\n")
  );
  return 0;
}

/**
 * Install hooks into the current repo.
 *
 * Writes, all idempotently:
 *   .poggle.json            project settings (no secrets — safe to commit)
 *   .claude/settings.json   Claude Code hook wiring, merged into what is there
 *   .git/hooks/post-commit  passive capture that works with no agent at all
 *   .gitignore              ignores .poggle/ (the spool holds session content)
 */
function cmdInit(config, args) {
  const project = getFlag(args, "--project") || config.project;
  const cwd = config.cwd;
  const written = [];

  // ── .poggle.json ─────────────────────────────────────────────────────────
  const repoConfigPath = path.join(cwd, ".poggle.json");
  const repoConfig = { ...readJsonSafe(repoConfigPath), project, api_url: config.apiUrl };
  fs.writeFileSync(repoConfigPath, JSON.stringify(repoConfig, null, 2) + "\n");
  written.push(".poggle.json");

  // ── Claude Code hooks ────────────────────────────────────────────────────
  const claudeDir = path.join(cwd, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, "settings.json");
  const settings = readJsonSafe(settingsPath);
  settings.hooks = settings.hooks || {};

  const cliPath = process.argv[1];
  const hookCommand = (event) => `node ${JSON.stringify(cliPath)} hook ${event}`;

  for (const event of [
    "SessionStart",
    "UserPromptSubmit",
    "PostToolUse",
    "PreCompact",
    "SessionEnd",
  ]) {
    const existing = settings.hooks[event] || [];
    // Idempotent: replace our own entry, leave every other hook untouched.
    const others = existing.filter(
      (entry) =>
        !JSON.stringify(entry).includes("poggle.mjs") &&
        !JSON.stringify(entry).includes("poggle hook")
    );
    settings.hooks[event] = [
      ...others,
      { hooks: [{ type: "command", command: hookCommand(event), timeout: 10 }] },
    ];
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  written.push(".claude/settings.json");

  // ── git post-commit ──────────────────────────────────────────────────────
  const gitHooksDir = path.join(cwd, ".git", "hooks");
  if (fs.existsSync(path.join(cwd, ".git"))) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
    const postCommit = path.join(gitHooksDir, "post-commit");
    const script = [
      "#!/bin/sh",
      "# poggle: passive capture — commits land in the relay even with no agent hook.",
      `SUBJECT=$(git log -1 --pretty=%s)`,
      `node ${JSON.stringify(cliPath)} log commit "$SUBJECT" >/dev/null 2>&1 &`,
      "exit 0",
      "",
    ].join("\n");
    // Never clobber an existing hook we did not write.
    if (!fs.existsSync(postCommit) || fs.readFileSync(postCommit, "utf8").includes("poggle")) {
      fs.writeFileSync(postCommit, script, { mode: 0o755 });
      written.push(".git/hooks/post-commit");
    } else {
      process.stdout.write(
        "note: .git/hooks/post-commit exists and was not written by poggle — left alone.\n"
      );
    }
  }

  // ── .gitignore ───────────────────────────────────────────────────────────
  const gitignorePath = path.join(cwd, ".gitignore");
  const gitignore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";
  if (!gitignore.includes(".poggle/")) {
    fs.appendFileSync(
      gitignorePath,
      `${gitignore.endsWith("\n") || gitignore === "" ? "" : "\n"}\n# poggle relay spool (may contain session content)\n.poggle/\n`
    );
    written.push(".gitignore");
  }

  process.stdout.write(
    [
      "",
      `Poggle relay installed for project: ${project}`,
      "",
      ...written.map((f) => `  wrote  ${f}`),
      "",
      config.token
        ? "Token found. Start an agent and its context will be logged."
        : [
            "No token configured yet. Create a relay key at:",
            `  ${config.apiUrl}/app/settings/relay_keys`,
            "",
            "That page hands you the exact command to run. Or by hand:",
            "  mkdir -p ~/.poggle",
            '  echo \'{"token":"pgr_v1_..."}\' > ~/.poggle/config.json',
          ].join("\n"),
      "",
      "Codex CLI: add this to ~/.codex/config.toml —",
      `  notify = ["node", ${JSON.stringify(cliPath)}, "hook", "Notification"]`,
      "",
    ].join("\n")
  );
  return 0;
}

// ─── Entry point ────────────────────────────────────────────────────────────

function getFlag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : "";
}

const USAGE = `poggle — agent context relay

  poggle init [--project <slug>]     install hooks into this repo
  poggle brief [--budget <tokens>]   print the handoff brief for this project
  poggle log <type> <summary>        log one event
  poggle checkpoint --summary "..."  write a distilled checkpoint
  poggle end [--reason <reason>]     close the current session
  poggle checkin [--intent "..."]    check in; see peers, claims, conflicts
  poggle ship-transcript --path <f>  upload an agent transcript
  poggle status                      show config and spool state
  poggle hook <HookEventName>        internal: called by agent hooks
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const config = loadConfig(process.cwd());

  switch (command) {
    case "init":
      return cmdInit(config, args);
    case "brief":
      return cmdBrief(config, args);
    case "log":
      return cmdLog(config, args);
    case "checkpoint":
      return cmdCheckpoint(config, args);
    case "end":
      return cmdEnd(config, args);
    case "hook":
      return cmdHook(config, args);
    case "checkin":
      return cmdCheckIn(config, args);
    case "ship-transcript":
      return cmdShipTranscript(config, args);
    case "status":
      return cmdStatus(config);
    default:
      process.stdout.write(USAGE);
      return command ? 1 : 0;
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    // Absolute last resort. A hook must never take an agent down with it.
    process.stderr.write(`poggle: ${err?.message ?? err}\n`);
    process.exit(0);
  });
