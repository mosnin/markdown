import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { type SessionEndReason } from "@/server/domain/constants/agent_session_constants";
import { endSession } from "@/server/services/session_ingest_service";

/**
 * Session reaping — inferring an ending nobody reported.
 *
 * A session that ends cleanly says so. The ones this product exists for do
 * not: an agent killed by a usage cap is gone mid-tool-call, no `SessionEnd`
 * hook fires, and the session sits "active" forever. Three things then go
 * wrong, in increasing order of harm:
 *
 *   1. The roster lies. A dead agent shows as live to every peer.
 *   2. Its claims linger until their TTL, so peers wait on a file nobody is
 *      editing.
 *   3. The handoff brief describes it as "still running", which is the exact
 *      opposite of the truth — its work is unfinished and needs picking up.
 *
 * Silence is the only signal available, so silence has to be interpreted.
 *
 * WHY THE REASON MATTERS MORE THAN THE REAPING. Guessing `completed` would be
 * the worst possible default: it tells the next agent the work was finished
 * when it was abandoned. So the reaper only claims `usage_capped` when the
 * session's own log supports it, and otherwise records `unknown` — which is
 * honest, and which the brief renders as "ended for an unrecorded reason"
 * rather than as success.
 */

/**
 * How long a session may be silent before we treat it as over.
 *
 * Deliberately much longer than the idle threshold. Going idle is cheap and
 * reversible — the session flips back to active the moment it speaks. Being
 * declared ended is not, so it takes real silence: an agent can legitimately
 * spend a long time inside one tool call, and ending a live session would be
 * a worse error than leaving a dead one open a little longer.
 */
export const SESSION_DEAD_AFTER_MS = 45 * 60 * 1000;

/**
 * How recently a cap signal must appear for silence to be read as a cap.
 *
 * A `usage_limit` event followed by silence is a cap. The same event an hour
 * before the session kept working is a warning it survived, and reading that
 * as the cause of a later disappearance would be a false attribution.
 */
const CAP_SIGNAL_WINDOW_MS = 20 * 60 * 1000;

/** Event types that count as the agent saying it hit a limit. */
const CAP_EVENT_TYPES = new Set(["usage_limit"]);

/**
 * Text signatures that mean a provider limit, seen in an error or a summary.
 *
 * Kept narrow on purpose. A false `usage_capped` is not harmless: it tells the
 * next agent the work was cut off when it may have finished, so anything
 * ambiguous is left as `unknown`.
 */
const CAP_TEXT_PATTERNS: readonly RegExp[] = [
  /usage limit reached/i,
  /rate limit (?:reached|exceeded)/i,
  /you(?:'ve| have) (?:hit|reached) your (?:usage|plan) limit/i,
  /quota (?:exceeded|exhausted)/i,
  /insufficient (?:quota|credits)/i,
  /\b429\b.*(?:limit|quota)/i,
  /out of (?:credits|tokens)/i,
];

export function looksLikeCapMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  return CAP_TEXT_PATTERNS.some((re) => re.test(text));
}

interface StaleSession {
  id: string;
  workspace_id: string;
  project_id: string;
  last_seen_at: string;
}

/**
 * Decide why a silent session stopped.
 *
 * Reads only its recent tail: a cap is the last thing that happens to a
 * session, so if the signal is not near the end it is not the cause.
 */
async function inferEndReason(
  client: SupabaseClient,
  session: StaleSession
): Promise<SessionEndReason> {
  const windowStart = new Date(
    Date.parse(session.last_seen_at) - CAP_SIGNAL_WINDOW_MS
  ).toISOString();

  const { data, error } = await client
    .from("session_events")
    .select("event_type, summary, payload")
    .eq("session_id", session.id)
    .gte("occurred_at", windowStart)
    .order("sequence", { ascending: false })
    .limit(25);

  if (error) {
    logger.warn(
      { err: error, sessionId: session.id },
      "Could not read session tail while reaping"
    );
    return "unknown";
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const eventType = String(row.event_type ?? "");
    if (CAP_EVENT_TYPES.has(eventType)) return "usage_capped";

    if (looksLikeCapMessage(String(row.summary ?? ""))) return "usage_capped";

    // Errors carry the provider's own wording, which is where the signature
    // usually is — the summary is often just "Bash: … — FAILED".
    const payload = row.payload as Record<string, unknown> | null;
    if (payload && looksLikeCapMessage(String(payload.error ?? ""))) {
      return "usage_capped";
    }
  }

  return "unknown";
}

/**
 * Close sessions that have gone silent, and say why.
 *
 * Uses `endSession`, not a direct update, so the whole ending happens: claims
 * released, `session.ended` and `session.capped` webhooks fired. A reaped cap
 * should reach Slack exactly as a self-reported one does — the team's need to
 * know is identical, and the fact that we inferred it is our problem, not
 * theirs.
 */
export async function reapStaleSessions(
  client: SupabaseClient,
  options: { deadAfterMs?: number; limit?: number } = {}
): Promise<{ ended: number; capped: number }> {
  const deadAfterMs = options.deadAfterMs ?? SESSION_DEAD_AFTER_MS;
  const cutoff = new Date(Date.now() - deadAfterMs).toISOString();

  const { data, error } = await client
    .from("agent_sessions")
    .select("id, workspace_id, project_id, last_seen_at")
    .neq("status", "ended")
    .lt("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: true })
    .limit(Math.min(200, Math.max(1, options.limit ?? 50)));

  if (error) {
    throw new Error(`Failed to list stale sessions: ${error.message}`);
  }

  const stale = (data ?? []) as StaleSession[];
  let ended = 0;
  let capped = 0;

  for (const session of stale) {
    try {
      const reason = await inferEndReason(client, session);
      await endSession(client, session.workspace_id, session.id, reason);
      ended += 1;
      if (reason === "usage_capped") capped += 1;
    } catch (err) {
      // One session that will not close must not stall the rest of the batch.
      logger.warn({ err, sessionId: session.id }, "Failed to reap session");
    }
  }

  if (ended > 0) {
    logger.info({ ended, capped }, "Reaped stale agent sessions");
  }

  return { ended, capped };
}
