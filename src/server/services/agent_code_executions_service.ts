import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Agent code executions — captured output of the `execute_code` sandbox tool.
 *
 * Whenever the agent runs a Python or JavaScript snippet in the sandbox we
 * persist the code and the captured stdout / stderr / return value here so
 * the UI can render "the agent ran this, and this is what came back" in
 * the run timeline, and so that downstream auditors can replay / inspect
 * past executions. Size caps are enforced at the runner — the `truncated`
 * boolean records when a stream was clipped so the UI can warn.
 *
 * Rows are always associated with a run; we also denormalize
 * `workspace_id` so the RLS policy can authorize reads without a join.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentCodeExecutionRow {
  id: string;
  run_id: string;
  workspace_id: string;
  tool_call_id: string | null;
  language: "python" | "javascript";
  code: string;
  stdout: string | null;
  stderr: string | null;
  return_value: string | null;
  exit_code: number | null;
  elapsed_ms: number | null;
  truncated: boolean;
  error: string | null;
  created_at: string;
}

export interface RecordCodeExecutionInput {
  runId: string;
  workspaceId: string;
  toolCallId?: string | null;
  language: "python" | "javascript";
  code: string;
  stdout?: string | null;
  stderr?: string | null;
  returnValue?: string | null;
  exitCode?: number | null;
  elapsedMs?: number | null;
  truncated?: boolean;
  error?: string | null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Persist a single sandboxed code execution. Returns the inserted row so
 * the caller can embed its id in the corresponding `tool_call_end` event
 * payload.
 */
export async function recordCodeExecution(
  supabase: SupabaseClient,
  input: RecordCodeExecutionInput
): Promise<AgentCodeExecutionRow> {
  const code = input.code;
  if (!code || code.length === 0) throw new Error("Code is required");

  const insertPayload: Record<string, unknown> = {
    run_id: input.runId,
    workspace_id: input.workspaceId,
    language: input.language,
    code,
  };
  if (input.toolCallId !== undefined) insertPayload.tool_call_id = input.toolCallId;
  if (input.stdout !== undefined) insertPayload.stdout = input.stdout;
  if (input.stderr !== undefined) insertPayload.stderr = input.stderr;
  if (input.returnValue !== undefined)
    insertPayload.return_value = input.returnValue;
  if (input.exitCode !== undefined) insertPayload.exit_code = input.exitCode;
  if (input.elapsedMs !== undefined) insertPayload.elapsed_ms = input.elapsedMs;
  if (input.truncated !== undefined) insertPayload.truncated = input.truncated;
  if (input.error !== undefined) insertPayload.error = input.error;

  const { data, error } = await supabase
    .from("agent_code_executions")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to record code execution: ${error?.message ?? "unknown"}`
    );
  }
  return data as AgentCodeExecutionRow;
}

/**
 * Fetch a single code-execution row by id. Returns null when no row
 * matches (or RLS hides it).
 */
export async function getCodeExecution(
  supabase: SupabaseClient,
  id: string
): Promise<AgentCodeExecutionRow | null> {
  const { data, error } = await supabase
    .from("agent_code_executions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load code execution: ${error.message}`);
  }
  return (data ?? null) as AgentCodeExecutionRow | null;
}

/**
 * List every code execution for a run in chronological order. Used by the
 * run timeline to stitch tool-call events to their captured outputs.
 */
export async function listCodeExecutionsForRun(
  supabase: SupabaseClient,
  runId: string
): Promise<AgentCodeExecutionRow[]> {
  const { data, error } = await supabase
    .from("agent_code_executions")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list code executions for run: ${error.message}`);
  }
  return (data ?? []) as AgentCodeExecutionRow[];
}
