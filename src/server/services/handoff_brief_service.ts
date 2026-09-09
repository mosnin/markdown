import { type SupabaseClient } from "@supabase/supabase-js";
import { ValidationError } from "@/server/domain/errors";
import {
  type AgentSession,
  type HandoffBrief,
  type Project,
  type SessionCheckpoint,
  type SessionEvent,
  type SessionState,
} from "@/server/domain/types/agent_session";
import {
  BRIEF_IMPORTANCE_FLOOR,
  DEFAULT_BRIEF_BUDGET_TOKENS,
  MAX_BRIEF_BUDGET_TOKENS,
  MIN_BRIEF_BUDGET_TOKENS,
  UNFINISHED_END_REASONS,
} from "@/server/domain/constants/agent_session_constants";
import { getProjectById } from "@/server/repositories/project_repository";
import { listRecentSessionsForBrief } from "@/server/repositories/agent_session_repository";
import {
  createHandoffBrief,
  getLatestCheckpoints,
  listSalientEvents,
} from "@/server/repositories/session_event_repository";

/**
 * Handoff brief assembly.
 *
 * This is the product. Everything else — hooks, ingest, the event log — exists
 * so that this function can answer one question well:
 *
 *   "I am a fresh agent on this repo. What happened before me, and what
 *    should I not have to rediscover?"
 *
 * Two commitments shape the implementation:
 *
 * DETERMINISTIC. No model call. The same log and the same budget produce the
 * same brief, byte for byte. A brief you cannot reproduce is a brief you
 * cannot debug, and an agent that gets a different story on each reconnect is
 * worse than one that gets none. (Model-written prose belongs in checkpoint
 * distillation, upstream of here, where its output is stored and auditable.)
 *
 * BUDGETED, IN PRIORITY ORDER. The brief is spent into a token budget from
 * most to least valuable. What survives a tight budget is what a resuming
 * agent would most regret not knowing:
 *
 *   1. Why the last session stopped — a cap means unfinished, not done.
 *   2. What is blocked, and what was already tried and failed. Re-running a
 *      failing approach is the most expensive mistake a fresh agent makes.
 *   3. Decisions already taken. Re-litigating them silently diverges the work.
 *   4. What was in flight — half-applied edits, a migration written but not
 *      run.
 *   5. What to do next.
 *   6. The recent timeline, as evidence for all of the above.
 *
 * Files touched come last: an agent can always read the repo, but it cannot
 * recover a decision that was never written down.
 */

// ─── Token accounting ───────────────────────────────────────────────────────

/**
 * Estimate tokens for a string.
 *
 * Four characters per token is the standard rough ratio for English prose and
 * code. We deliberately do not import a real tokeniser: this runs on the hot
 * path of every session start, the budget is a soft guard rather than a hard
 * API limit, and a 10% error costs a couple of lines of timeline.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A candidate section, with the priority that decides what gets cut. */
interface BriefBlock {
  /** Lower runs first and survives longest. */
  priority: number;
  text: string;
}

// ─── State merging ──────────────────────────────────────────────────────────

/**
 * Fold several sessions' states into one, newest first.
 *
 * List fields concatenate with de-duplication, preserving first-seen order so
 * the newest session's framing leads. Scalar fields (goal) take the newest
 * non-empty value: if the most recent session restated the goal, that is the
 * current goal.
 */
export function mergeStates(states: SessionState[]): SessionState {
  const merged: SessionState = {};
  const listKeys = [
    "done",
    "in_flight",
    "blocked",
    "decisions",
    "next_steps",
    "files_touched",
    "open_questions",
  ] as const;

  for (const key of listKeys) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const state of states) {
      for (const item of state[key] ?? []) {
        const trimmed = item.trim();
        if (trimmed.length === 0) continue;
        const dedupeKey = trimmed.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push(trimmed);
      }
    }
    if (out.length > 0) merged[key] = out;
  }

  for (const state of states) {
    if (state.goal && state.goal.trim().length > 0) {
      merged.goal = state.goal.trim();
      break;
    }
  }

  return merged;
}

// ─── Rendering helpers ──────────────────────────────────────────────────────

function formatDuration(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatRelative(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Human-readable label for how a session ended. */
function describeEnding(session: AgentSession, now: number): string {
  if (session.status !== "ended") {
    const idleFor = formatRelative(session.last_seen_at, now);
    return session.status === "idle"
      ? `still open but quiet since ${idleFor}`
      : `still running, last active ${idleFor}`;
  }
  switch (session.end_reason) {
    case "usage_capped":
      return "**stopped on a usage cap — its work was not finished**";
    case "context_exhausted":
      return "**ran out of context — its work was not finished**";
    case "crashed":
      return "**crashed — its work was not finished**";
    case "user_stopped":
      return "stopped by the user";
    case "completed":
      return "finished normally";
    default:
      return "ended for an unrecorded reason";
  }
}

function bulletList(items: string[], limit: number): string {
  return items
    .slice(0, limit)
    .map((item) => `- ${item}`)
    .join("\n");
}

// ─── Assembly ───────────────────────────────────────────────────────────────

export interface BriefRequest {
  project_id: string;
  budget_tokens?: number;
  /** The session asking. Excluded from its own history. */
  requesting_session_id?: string | null;
  /** Cap on how many prior sessions to fold in. */
  max_sessions?: number;
  /** Persist the brief. Off for previews. */
  persist?: boolean;
}

export interface AssembledBrief {
  body: string;
  state: SessionState;
  token_estimate: number;
  budget_tokens: number;
  source_session_ids: string[];
  /** True when the log held nothing useful — callers may want to say so. */
  empty: boolean;
}

/**
 * Build the brief for a project.
 *
 * Reads at most `max_sessions` prior sessions, prefers each session's latest
 * checkpoint over its raw events, and spends the budget in priority order.
 */
export async function assembleBrief(
  client: SupabaseClient,
  workspaceId: string,
  request: BriefRequest
): Promise<AssembledBrief & { project: Project }> {
  const project = await getProjectById(client, request.project_id);
  if (!project || project.workspace_id !== workspaceId) {
    throw new ValidationError(`Project ${request.project_id} not found`);
  }

  const budget = Math.min(
    MAX_BRIEF_BUDGET_TOKENS,
    Math.max(
      MIN_BRIEF_BUDGET_TOKENS,
      request.budget_tokens ?? DEFAULT_BRIEF_BUDGET_TOKENS
    )
  );
  const maxSessions = Math.min(20, Math.max(1, request.max_sessions ?? 5));

  const sessions = await listRecentSessionsForBrief(client, project.id, {
    excludeSessionId: request.requesting_session_id ?? undefined,
    limit: maxSessions,
  });

  if (sessions.length === 0) {
    const body =
      `# Handoff brief — ${project.name}\n\n` +
      `No earlier agent sessions have been logged for this project yet. ` +
      `You are the first. Log what you do as you go so the next session ` +
      `does not start from zero.\n`;
    return {
      project,
      body,
      state: {},
      token_estimate: estimateTokens(body),
      budget_tokens: budget,
      source_session_ids: [],
      empty: true,
    };
  }

  const sessionIds = sessions.map((s) => s.id);
  const checkpoints = await getLatestCheckpoints(client, sessionIds);

  // Pull salient events only for sessions with no checkpoint, or whose
  // checkpoint has fallen behind the log. A current checkpoint is strictly
  // better than the events it summarises, and much cheaper.
  const eventsBySession = new Map<string, SessionEvent[]>();
  await Promise.all(
    sessions.map(async (session) => {
      const checkpoint = checkpoints.get(session.id);
      const behind =
        !checkpoint || checkpoint.seq_to < session.event_count;
      if (!behind) return;
      const events = await listSalientEvents(client, session.id, {
        minImportance: BRIEF_IMPORTANCE_FLOOR + 1,
        limit: 25,
        afterSequence: checkpoint?.seq_to,
      });
      if (events.length > 0) eventsBySession.set(session.id, events);
    })
  );

  const state = mergeStates(
    sessions
      .map((s) => checkpoints.get(s.id)?.state)
      .filter((s): s is SessionState => Boolean(s))
  );

  const now = Date.now();
  const blocks = buildBlocks({
    project,
    sessions,
    checkpoints,
    eventsBySession,
    state,
    now,
  });

  const { body, tokenEstimate } = spendBudget(blocks, budget);

  return {
    project,
    body,
    state,
    token_estimate: tokenEstimate,
    budget_tokens: budget,
    source_session_ids: sessionIds,
    empty: false,
  };
}

interface BuildBlocksArgs {
  project: Project;
  sessions: AgentSession[];
  checkpoints: Map<string, SessionCheckpoint>;
  eventsBySession: Map<string, SessionEvent[]>;
  state: SessionState;
  now: number;
}

/**
 * Turn gathered material into prioritised blocks.
 *
 * Priorities are spaced by 10 so a block can be slipped between two of them
 * later without renumbering everything.
 */
function buildBlocks(args: BuildBlocksArgs): BriefBlock[] {
  const { project, sessions, checkpoints, eventsBySession, state, now } = args;
  const blocks: BriefBlock[] = [];

  // ── 0. Header: who was here, and did they finish ──────────────────────────
  const latest = sessions[0];
  const unfinished = sessions.filter(
    (s) =>
      s.end_reason !== null &&
      UNFINISHED_END_REASONS.includes(s.end_reason)
  );

  const headerLines = [
    `# Handoff brief — ${project.name}`,
    "",
    `You are picking up work already in progress. ` +
      `${sessions.length} earlier session${sessions.length === 1 ? "" : "s"} ` +
      `logged context for this project.`,
    "",
    `**Most recent:** ${latest.agent_tool}` +
      (latest.agent_model ? ` (${latest.agent_model})` : "") +
      (latest.account_label ? ` on ${latest.account_label}` : "") +
      `, ${formatRelative(latest.last_seen_at, now)}, ` +
      `ran ${formatDuration(latest.started_at, latest.ended_at ?? latest.last_seen_at)}, ` +
      `${describeEnding(latest, now)}.`,
  ];

  if (latest.git_branch) {
    headerLines.push("", `**Branch:** \`${latest.git_branch}\``);
  }

  if (unfinished.length > 0) {
    headerLines.push(
      "",
      `> ${unfinished.length} session${unfinished.length === 1 ? "" : "s"} ` +
        `ended without finishing. Treat everything below as work in progress, ` +
        `not as a completed change.`
    );
  }

  blocks.push({ priority: 0, text: headerLines.join("\n") });

  // ── 10. The goal ──────────────────────────────────────────────────────────
  const goal = state.goal ?? latest.goal ?? latest.title;
  if (goal) {
    blocks.push({ priority: 10, text: `## Goal\n\n${goal}` });
  }

  // ── 20. Blockers: the most expensive thing to rediscover ──────────────────
  if (state.blocked?.length) {
    blocks.push({
      priority: 20,
      text:
        `## Blocked / already tried and failed\n\n` +
        `Do not re-attempt these without new information.\n\n` +
        bulletList(state.blocked, 10),
    });
  }

  // ── 30. Open questions ────────────────────────────────────────────────────
  if (state.open_questions?.length) {
    blocks.push({
      priority: 30,
      text: `## Open questions\n\n${bulletList(state.open_questions, 8)}`,
    });
  }

  // ── 40. Decisions already made ────────────────────────────────────────────
  if (state.decisions?.length) {
    blocks.push({
      priority: 40,
      text:
        `## Decisions already made\n\n` +
        `These were settled by earlier sessions. Follow them unless you have ` +
        `a reason to reopen one, and say so if you do.\n\n` +
        bulletList(state.decisions, 12),
    });
  }

  // ── 50. In flight ─────────────────────────────────────────────────────────
  if (state.in_flight?.length) {
    blocks.push({
      priority: 50,
      text:
        `## In flight when the last session stopped\n\n` +
        bulletList(state.in_flight, 10),
    });
  }

  // ── 60. Next steps ────────────────────────────────────────────────────────
  if (state.next_steps?.length) {
    blocks.push({
      priority: 60,
      text: `## Planned next steps\n\n${bulletList(state.next_steps, 10)}`,
    });
  }

  // ── 70. Done ──────────────────────────────────────────────────────────────
  if (state.done?.length) {
    blocks.push({
      priority: 70,
      text: `## Already done\n\n${bulletList(state.done, 12)}`,
    });
  }

  // ── 80+. Per-session narrative, newest first ──────────────────────────────
  sessions.forEach((session, index) => {
    const checkpoint = checkpoints.get(session.id);
    const events = eventsBySession.get(session.id) ?? [];
    if (!checkpoint && events.length === 0) return;

    const lines = [
      `### ${session.agent_tool}` +
        (session.account_label ? ` · ${session.account_label}` : "") +
        ` · ${formatRelative(session.started_at, now)} · ${describeEnding(session, now)}`,
    ];

    if (checkpoint) {
      lines.push("", checkpoint.summary.trim());
    }

    if (events.length > 0) {
      // Present chronologically: a resuming agent reads this as a story.
      const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
      lines.push(
        "",
        ...ordered.map((e) => `- \`${e.event_type}\` ${e.summary}`)
      );
    }

    blocks.push({
      priority: 80 + index,
      text: (index === 0 ? "## Session log\n\n" : "") + lines.join("\n"),
    });
  });

  // ── 200. Files, last: the repo can always be read ─────────────────────────
  const files = state.files_touched?.length
    ? state.files_touched
    : dedupeFiles(eventsBySession);
  if (files.length > 0) {
    blocks.push({
      priority: 200,
      text:
        `## Files touched\n\n` +
        files
          .slice(0, 40)
          .map((f) => `- \`${f}\``)
          .join("\n"),
    });
  }

  return blocks;
}

function dedupeFiles(eventsBySession: Map<string, SessionEvent[]>): string[] {
  const seen = new Set<string>();
  for (const events of eventsBySession.values()) {
    for (const event of events) {
      for (const file of event.files) seen.add(file);
    }
  }
  return [...seen];
}

/**
 * Concatenate blocks in priority order until the budget runs out.
 *
 * A block is all-or-nothing: half a "Decisions" section reads as if the list
 * were complete, which is worse than omitting it. When a block is skipped we
 * keep going rather than stopping, because a later block may be small enough
 * to fit — and the note at the end tells the reader something was dropped.
 */
function spendBudget(
  blocks: BriefBlock[],
  budget: number
): { body: string; tokenEstimate: number } {
  const ordered = [...blocks].sort((a, b) => a.priority - b.priority);

  const kept: string[] = [];
  let used = 0;
  let dropped = 0;

  // Reserve room for the truncation note so adding it can never bust the budget.
  const reserve = 40;

  for (const block of ordered) {
    const cost = estimateTokens(block.text) + 2; // +2 for the joining blank line
    if (used + cost > budget - reserve) {
      dropped += 1;
      continue;
    }
    kept.push(block.text);
    used += cost;
  }

  let body = kept.join("\n\n");

  if (dropped > 0) {
    const note =
      `\n\n---\n\n_${dropped} lower-priority section${dropped === 1 ? "" : "s"} ` +
      `omitted to fit a ${budget}-token budget. Ask for a larger budget, or read ` +
      `the full log, if you need them._\n`;
    body += note;
    used += estimateTokens(note);
  }

  return { body: `${body}\n`, tokenEstimate: used };
}

/**
 * Assemble a brief and persist it.
 *
 * Persisting is the default for real handoffs: it is the record of exactly
 * what context crossed from one account to the next, which matters when the
 * next agent does something surprising and you need to know what it was told.
 */
export async function createBriefForProject(
  client: SupabaseClient,
  workspaceId: string,
  request: BriefRequest
): Promise<{ brief: HandoffBrief | null; assembled: AssembledBrief }> {
  const assembled = await assembleBrief(client, workspaceId, request);

  if (request.persist === false || assembled.empty) {
    return { brief: null, assembled };
  }

  const brief = await createHandoffBrief(client, {
    workspace_id: workspaceId,
    project_id: request.project_id,
    requested_by_session_id: request.requesting_session_id ?? null,
    source_session_ids: assembled.source_session_ids,
    budget_tokens: assembled.budget_tokens,
    token_estimate: assembled.token_estimate,
    body: assembled.body,
    state: assembled.state,
  });

  return { brief, assembled };
}
