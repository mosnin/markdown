import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import { withApiHandler } from "@/server/api/with_api_handler";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import { getSessionById } from "@/server/repositories/agent_session_repository";
import { createCheckpoint } from "@/server/repositories/session_event_repository";
import { estimateTokens } from "@/server/services/handoff_brief_service";
import { redactString, redactFilePaths } from "@/server/services/session_event_redaction";
import {
  CHECKPOINT_KINDS,
  type CheckpointKind,
} from "@/server/domain/constants/agent_session_constants";
import { type SessionState } from "@/server/domain/types/agent_session";

export const dynamic = "force-dynamic";

const CHECKPOINT_KIND_SET = new Set<string>(CHECKPOINT_KINDS);

/** Cap on how many items we accept per state list. */
const MAX_STATE_ITEMS = 25;
/** Cap on each item's length, so one rambling entry cannot eat a brief. */
const MAX_STATE_ITEM_CHARS = 500;

function normaliseList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => redactString(item.trim()).slice(0, MAX_STATE_ITEM_CHARS))
    .filter((item) => item.length > 0)
    .slice(0, MAX_STATE_ITEMS);
  return out.length > 0 ? out : undefined;
}

function normaliseState(raw: unknown): SessionState {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const state: SessionState = {};

  if (typeof input.goal === "string" && input.goal.trim().length > 0) {
    state.goal = redactString(input.goal.trim()).slice(0, 2000);
  }
  state.done = normaliseList(input.done);
  state.in_flight = normaliseList(input.in_flight);
  state.blocked = normaliseList(input.blocked);
  state.decisions = normaliseList(input.decisions);
  state.next_steps = normaliseList(input.next_steps);
  state.open_questions = normaliseList(input.open_questions);

  const files = normaliseList(input.files_touched);
  if (files) state.files_touched = redactFilePaths(files);

  // Drop undefined keys so the stored jsonb stays tight.
  return Object.fromEntries(
    Object.entries(state).filter(([, v]) => v !== undefined)
  ) as SessionState;
}

/**
 * POST /api/v1/relay/checkpoints
 *
 * Write a distilled snapshot of a session's state.
 *
 * This is the highest-value thing an agent can send us, and the cheapest thing
 * for a brief to consume: one checkpoint replaces the two hundred events it
 * summarises. Agents are expected to write one when they learn something
 * structural — a decision, a dead end — and the hook shims force one at two
 * moments where context is otherwise lost forever:
 *
 *   kind='compaction'   just before the agent compacts its own context
 *   kind='session_end'  as the run finishes or is cut off
 *
 * Body:
 *   { session_id, kind?, summary, state? }
 *
 * `state` is the structured half: { goal, done[], in_flight[], blocked[],
 * decisions[], next_steps[], files_touched[], open_questions[] }.
 *
 * Auth: relay key, or OAuth token with `relay:write`.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveRelayAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!ctx.canWrite) return E_INSUFFICIENT_SCOPE("relay:write");

  let body: {
    session_id?: string;
    kind?: string;
    summary?: string;
    state?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  if (!body.session_id) return E_BAD_REQUEST("session_id is required");
  if (!body.summary || body.summary.trim().length === 0) {
    return E_BAD_REQUEST("summary is required");
  }

  const admin = createAdminClient();
  const session = await getSessionById(admin, body.session_id);
  if (!session || session.workspace_id !== ctx.workspaceId) {
    return E_NOT_FOUND("Session not found");
  }

  const kind: CheckpointKind =
    body.kind && CHECKPOINT_KIND_SET.has(body.kind)
      ? (body.kind as CheckpointKind)
      : "manual";

  const summary = redactString(body.summary.trim()).slice(0, 20000);
  const state = normaliseState(body.state);

  const checkpoint = await createCheckpoint(admin, {
    workspace_id: session.workspace_id,
    project_id: session.project_id,
    session_id: session.id,
    kind,
    // A checkpoint covers everything logged so far that no checkpoint covered.
    // We record the session's current high-water mark as the upper bound; the
    // brief assembler uses it to decide whether the checkpoint is still current.
    seq_from: 0,
    seq_to: session.event_count,
    summary,
    state,
    token_estimate: estimateTokens(summary + JSON.stringify(state)),
  });

  return apiOk(
    {
      checkpoint_id: checkpoint.id,
      session_id: session.id,
      kind: checkpoint.kind,
      seq_to: checkpoint.seq_to,
      token_estimate: checkpoint.token_estimate,
    },
    201
  );
});
