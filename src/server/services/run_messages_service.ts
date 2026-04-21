import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Run messages — mid-run steering inbox for a workspace member to nudge
 * an in-flight agent run ("wait, focus on X instead", "stop at the next
 * boundary and summarize", etc.).
 *
 * The Python agent polls {@link listUnreadMessages} between tool calls,
 * consumes whatever it finds, and calls {@link markMessagesConsumed} to
 * clear them so they're not re-delivered. Messages are capped at 4000
 * characters by a DB CHECK; we enforce the same bound (post-trim) at the
 * service layer so callers get a clean error before hitting Postgres.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunMessageRow {
  id: string;
  run_id: string;
  workspace_id: string;
  sender_user_id: string;
  content: string;
  consumed_at: string | null;
  created_at: string;
}

export interface SendMessageInput {
  runId: string;
  workspaceId: string;
  senderUserId: string;
  content: string;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Send a steering message to an in-flight run. Validates `content` length
 * (1..4000 after trimming) before inserting — the same bound the DB
 * enforces, but surfaced as an Error the route can translate into a 400.
 */
export async function sendMessage(
  supabase: SupabaseClient,
  input: SendMessageInput
): Promise<RunMessageRow> {
  const content = input.content.trim();
  if (content.length < 1 || content.length > 4000) {
    throw new Error("Message content must be between 1 and 4000 characters");
  }

  const { data, error } = await supabase
    .from("run_messages")
    .insert({
      run_id: input.runId,
      workspace_id: input.workspaceId,
      sender_user_id: input.senderUserId,
      content,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to send run message: ${error?.message ?? "unknown"}`);
  }
  return data as RunMessageRow;
}

/**
 * List messages the agent hasn't picked up yet. Ascending by `created_at`
 * so the agent consumes them in the order the user sent them.
 */
export async function listUnreadMessages(
  supabase: SupabaseClient,
  runId: string
): Promise<RunMessageRow[]> {
  const { data, error } = await supabase
    .from("run_messages")
    .select("*")
    .eq("run_id", runId)
    .is("consumed_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list unread messages: ${error.message}`);
  return (data ?? []) as RunMessageRow[];
}

/**
 * List all messages for a run (consumed or not) in ascending creation
 * order. Used by the run timeline UI. `limit` defaults to 100 and is
 * capped at 500 to keep the response bounded.
 */
export async function listMessagesForRun(
  supabase: SupabaseClient,
  runId: string,
  limit: number = 100
): Promise<RunMessageRow[]> {
  const capped = Math.max(1, Math.min(limit, 500));

  const { data, error } = await supabase
    .from("run_messages")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true })
    .limit(capped);

  if (error) throw new Error(`Failed to list run messages: ${error.message}`);
  return (data ?? []) as RunMessageRow[];
}

/**
 * Mark a batch of messages as consumed by the agent. Stamps `consumed_at`
 * with the current server-side `now()`. Returns the number of rows
 * updated — can be less than `ids.length` if some rows were already
 * consumed, hidden by RLS, or deleted. Passing an empty array is a no-op
 * that returns 0.
 */
export async function markMessagesConsumed(
  supabase: SupabaseClient,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;

  const { data, error } = await supabase
    .from("run_messages")
    .update({ consumed_at: new Date().toISOString() })
    .in("id", ids)
    .select("id");

  if (error) {
    throw new Error(`Failed to mark messages consumed: ${error.message}`);
  }
  return (data ?? []).length;
}
