import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Operator run events — durable, ordered stream of every lifecycle and
 * tool-call event produced by a Workspace Operator run.
 *
 * Today events are broadcast to the UI over Supabase Realtime on a
 * fire-and-forget basis. Persisting them here gives us three things:
 *
 *   1. Replay / audit — an operator run can be reconstructed after the
 *      fact for debugging, billing disputes, or compliance.
 *   2. Reconnect mid-run — a client that drops off can re-read the
 *      history since a given `sequence` and then resume streaming.
 *   3. Usage accounting — `usage_update` rows are the canonical source
 *      of token counts per turn (alongside the denormalised totals on
 *      `workspace_operator_runs`).
 *
 * Events are ordered per-run by the `sequence` column. Supabase has no
 * built-in per-partition auto-increment so we compute
 * `COALESCE(MAX(sequence), 0) + 1` at insert time — see {@link recordEvent}
 * for the concurrency note.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Mirror of the CHECK constraint on `operator_run_events.event_type`. Keep
 * in sync with the migration — if you add an event type in SQL, add it here.
 */
export type OperatorRunEventType =
  | "run_start"
  | "run_end"
  | "plan_ready"
  | "plan_approved"
  | "step_start"
  | "step_complete"
  | "tool_call_start"
  | "tool_call_end"
  | "tool_call_error"
  | "tool_call_approval_requested"
  | "tool_call_approval_granted"
  | "tool_call_approval_rejected"
  | "tool_call_preview_diff"
  | "llm_call_start"
  | "llm_call_end"
  | "usage_update"
  | "note_drafted"
  | "steer_message_received"
  | "guardrail_tripped"
  | "subagent_start"
  | "subagent_end"
  /** Token-level streaming delta from Pog. Payload: { text: string }. Phase 7. */
  | "text_delta"
  | "completed"
  | "failed"
  | "cancelled";

export interface OperatorRunEventRow {
  id: string;
  run_id: string;
  workspace_id: string;
  sequence: number;
  event_type: OperatorRunEventType;
  tool_name: string | null;
  tool_call_id: string | null;
  step_index: number | null;
  payload: unknown;
  elapsed_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface RecordEventInput {
  runId: string;
  workspaceId: string;
  eventType: OperatorRunEventType;
  toolName?: string | null;
  toolCallId?: string | null;
  stepIndex?: number | null;
  payload?: unknown;
  elapsedMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface ListEventsParams {
  /** Required — events are streamed per-run. */
  runId: string;
  /**
   * Cursor for resuming a stream. When set, only events with
   * `sequence > afterSequence` are returned. Omit to read from the start.
   */
  afterSequence?: number | null;
  /** Page size. Defaults to 200, capped at 500. */
  limit?: number;
}

export interface ListEventsResult {
  rows: OperatorRunEventRow[];
  /** The last row's `sequence`, or null when the page was not full. */
  nextCursor: number | null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Insert a new event row for a run.
 *
 * Concurrency note: we compute the next `sequence` with a SELECT-then-INSERT
 * rather than a DB-side sequence generator (the table has a unique index on
 * `(run_id, sequence)` but no per-run auto-increment). Two concurrent writers
 * can therefore collide on the same sequence and the second INSERT will fail
 * with a unique-violation. We catch that case and retry once with a freshly
 * computed sequence. In practice this is rare because a single run has a
 * single agent driver writing events serially; it can happen when the driver
 * and a side-channel (e.g. a webhook) both try to record at the same tick.
 */
export async function recordEvent(
  supabase: SupabaseClient,
  input: RecordEventInput
): Promise<OperatorRunEventRow> {
  const attempt = async (): Promise<{
    row: OperatorRunEventRow | null;
    uniqueViolation: boolean;
    errorMessage: string | null;
  }> => {
    const { data: maxRow, error: maxError } = await supabase
      .from("operator_run_events")
      .select("sequence")
      .eq("run_id", input.runId)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxError) {
      throw new Error(
        `Failed to compute next event sequence: ${maxError.message}`
      );
    }

    const nextSequence =
      ((maxRow as { sequence: number } | null)?.sequence ?? 0) + 1;

    const insertPayload: Record<string, unknown> = {
      run_id: input.runId,
      workspace_id: input.workspaceId,
      sequence: nextSequence,
      event_type: input.eventType,
      payload: input.payload ?? {},
    };
    if (input.toolName !== undefined) insertPayload.tool_name = input.toolName;
    if (input.toolCallId !== undefined)
      insertPayload.tool_call_id = input.toolCallId;
    if (input.stepIndex !== undefined)
      insertPayload.step_index = input.stepIndex;
    if (input.elapsedMs !== undefined) insertPayload.elapsed_ms = input.elapsedMs;
    if (input.inputTokens !== undefined)
      insertPayload.input_tokens = input.inputTokens;
    if (input.outputTokens !== undefined)
      insertPayload.output_tokens = input.outputTokens;

    const { data, error } = await supabase
      .from("operator_run_events")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      // Postgres unique_violation. Retry once.
      const isUniqueViolation =
        (error as { code?: string }).code === "23505" ||
        /duplicate key|unique/i.test(error.message ?? "");
      return {
        row: null,
        uniqueViolation: isUniqueViolation,
        errorMessage: error.message ?? null,
      };
    }
    return { row: data as OperatorRunEventRow, uniqueViolation: false, errorMessage: null };
  };

  const first = await attempt();
  if (first.row) return first.row;

  if (first.uniqueViolation) {
    const second = await attempt();
    if (second.row) return second.row;
    throw new Error(
      `Failed to record operator run event after retry: ${second.errorMessage ?? "unknown"}`
    );
  }

  throw new Error(
    `Failed to record operator run event: ${first.errorMessage ?? "unknown"}`
  );
}

/**
 * Read events for a run in ascending sequence order. The `afterSequence`
 * cursor is exclusive — pass back `nextCursor` from the previous page to
 * continue the stream. Uses a limit+1 pattern internally so the caller
 * knows whether more rows exist.
 */
export async function listEventsForRun(
  supabase: SupabaseClient,
  params: ListEventsParams
): Promise<ListEventsResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 200, 500));

  let query = supabase
    .from("operator_run_events")
    .select("*")
    .eq("run_id", params.runId)
    .order("sequence", { ascending: true })
    .limit(limit + 1);

  if (params.afterSequence !== undefined && params.afterSequence !== null) {
    query = query.gt("sequence", params.afterSequence);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list operator run events: ${error.message}`);
  }

  const all = (data ?? []) as OperatorRunEventRow[];
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  const nextCursor = hasMore ? (rows[rows.length - 1]?.sequence ?? null) : null;

  return { rows, nextCursor };
}

/**
 * Fetch the N most recent events of a specific type for a run. Useful for
 * pulling e.g. the last few `usage_update` rows without replaying the full
 * stream. Rows are returned newest-first.
 */
export async function getLatestEventsByType(
  supabase: SupabaseClient,
  runId: string,
  eventType: OperatorRunEventType,
  limit: number = 10
): Promise<OperatorRunEventRow[]> {
  const capped = Math.max(1, Math.min(limit, 500));

  const { data, error } = await supabase
    .from("operator_run_events")
    .select("*")
    .eq("run_id", runId)
    .eq("event_type", eventType)
    .order("sequence", { ascending: false })
    .limit(capped);

  if (error) {
    throw new Error(
      `Failed to load latest '${eventType}' events: ${error.message}`
    );
  }
  return (data ?? []) as OperatorRunEventRow[];
}
