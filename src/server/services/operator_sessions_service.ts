import { type SupabaseClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OperatorSession {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  workspaceId: string;
  userId: string;
  name?: string;
}

export interface UpdateSessionInput {
  name?: string;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createOperatorSession(
  supabase: SupabaseClient,
  input: CreateSessionInput
): Promise<OperatorSession> {
  const { data, error } = await supabase
    .from("workspace_operator_sessions")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      name: input.name ?? "New session",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create operator session: ${error?.message ?? "unknown"}`);
  }
  return data as OperatorSession;
}

export async function listOperatorSessions(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  limit = 50
): Promise<OperatorSession[]> {
  const { data, error } = await supabase
    .from("workspace_operator_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list operator sessions: ${error.message}`);
  return (data ?? []) as OperatorSession[];
}

export async function getOperatorSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<OperatorSession | null> {
  const { data, error } = await supabase
    .from("workspace_operator_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get operator session: ${error.message}`);
  return (data ?? null) as OperatorSession | null;
}

export async function updateOperatorSession(
  supabase: SupabaseClient,
  sessionId: string,
  patch: UpdateSessionInput
): Promise<OperatorSession> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim() || "New session";

  const { data, error } = await supabase
    .from("workspace_operator_sessions")
    .update(update)
    .eq("id", sessionId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update operator session: ${error?.message ?? "unknown"}`);
  }
  return data as OperatorSession;
}

export async function deleteOperatorSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<void> {
  const { error } = await supabase
    .from("workspace_operator_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) throw new Error(`Failed to delete operator session: ${error.message}`);
}

/**
 * Increment run_count and update last_run_at after a run is associated with
 * this session. Called server-side after creating a run with a session_id.
 */
export async function touchOperatorSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<void> {
  // Read current count, increment, and write back. Supabase doesn't support
  // atomic increments in the JS client without RPC, so we do a read-then-write.
  // Race conditions here only affect cosmetic counters — not correctness.
  const { data: existing } = await supabase
    .from("workspace_operator_sessions")
    .select("run_count")
    .eq("id", sessionId)
    .maybeSingle();

  const currentCount = (existing as { run_count: number } | null)?.run_count ?? 0;

  await supabase
    .from("workspace_operator_sessions")
    .update({
      run_count: currentCount + 1,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}
