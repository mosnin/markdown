import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Agent memories — persistent cross-session memory keyed by workspace.
 *
 * The agent writes structured memory entries across runs (workspace facts,
 * user preferences, recent work, learned schemas, project context) and
 * reads the most relevant ones into the prologue of subsequent runs. Each
 * row carries a `relevance` score in [0, 10]; the agent boosts it on
 * reuse and decays stale entries over time.
 *
 * `last_used_at` is a softer signal than `relevance` — updated by
 * {@link touchMemory} whenever a memory is pulled into a prompt, it lets
 * us break ties between equally-relevant entries by recency.
 *
 * Note: the DB's admin RLS policy gates DELETE on `can_admin_workspace`;
 * INSERT / UPDATE allow any workspace member. This service does not
 * enforce that split — it trusts the SupabaseClient's auth context.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentMemoryType =
  | "workspace_facts"
  | "user_preferences"
  | "recent_work"
  | "learned_schemas"
  | "project_context";

export interface AgentMemoryRow {
  id: string;
  workspace_id: string;
  memory_type: AgentMemoryType;
  title: string;
  content: string;
  relevance: number;
  created_by_run: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface CreateMemoryInput {
  workspaceId: string;
  memoryType: AgentMemoryType;
  title: string;
  content: string;
  relevance?: number;
  createdByRun?: string | null;
}

export interface UpdateMemoryPatch {
  title?: string;
  content?: string;
  relevance?: number;
  lastUsedAt?: string | null;
}

export interface ListMemoriesParams {
  workspaceId: string;
  memoryType?: AgentMemoryType;
  minRelevance?: number;
  limit?: number;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Insert a new memory row. Validates title / content lengths and relevance
 * bounds up front so the caller gets an actionable error before the DB
 * CHECK rejects the insert.
 */
export async function createMemory(
  supabase: SupabaseClient,
  input: CreateMemoryInput
): Promise<AgentMemoryRow> {
  const title = input.title.trim();
  const content = input.content.trim();

  if (title.length < 1 || title.length > 200) {
    throw new Error("Memory title must be between 1 and 200 characters");
  }
  if (content.length < 1 || content.length > 8000) {
    throw new Error("Memory content must be between 1 and 8000 characters");
  }
  const relevance = input.relevance ?? 1.0;
  if (relevance < 0 || relevance > 10) {
    throw new Error("Memory relevance must be between 0 and 10");
  }

  const { data, error } = await supabase
    .from("agent_memories")
    .insert({
      workspace_id: input.workspaceId,
      memory_type: input.memoryType,
      title,
      content,
      relevance,
      created_by_run: input.createdByRun ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create agent memory: ${error?.message ?? "unknown"}`);
  }
  return data as AgentMemoryRow;
}

/**
 * Apply a partial update to a memory row. Re-validates the same length /
 * range bounds `createMemory` enforces for any field that's present.
 */
export async function updateMemory(
  supabase: SupabaseClient,
  memoryId: string,
  patch: UpdateMemoryPatch
): Promise<AgentMemoryRow> {
  const update: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length < 1 || title.length > 200) {
      throw new Error("Memory title must be between 1 and 200 characters");
    }
    update.title = title;
  }
  if (patch.content !== undefined) {
    const content = patch.content.trim();
    if (content.length < 1 || content.length > 8000) {
      throw new Error("Memory content must be between 1 and 8000 characters");
    }
    update.content = content;
  }
  if (patch.relevance !== undefined) {
    if (patch.relevance < 0 || patch.relevance > 10) {
      throw new Error("Memory relevance must be between 0 and 10");
    }
    update.relevance = patch.relevance;
  }
  if (patch.lastUsedAt !== undefined) update.last_used_at = patch.lastUsedAt;

  if (Object.keys(update).length === 0) {
    const existing = await getMemory(supabase, memoryId);
    if (!existing) throw new Error("Agent memory not found");
    return existing;
  }

  const { data, error } = await supabase
    .from("agent_memories")
    .update(update)
    .eq("id", memoryId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update agent memory: ${error?.message ?? "unknown"}`);
  }
  return data as AgentMemoryRow;
}

/**
 * Hard-delete a memory row. Gated by the DB's
 * `can_admin_workspace`-scoped DELETE policy.
 */
export async function deleteMemory(
  supabase: SupabaseClient,
  memoryId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_memories")
    .delete()
    .eq("id", memoryId);

  if (error) throw new Error(`Failed to delete agent memory: ${error.message}`);
}

/**
 * List memories for a workspace, ordered most-relevant first. Falls back
 * to `last_used_at` DESC (NULLS LAST) to break ties between equally-scored
 * entries. `limit` defaults to 20, hard-capped at 100.
 */
export async function listMemories(
  supabase: SupabaseClient,
  params: ListMemoriesParams
): Promise<AgentMemoryRow[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const minRelevance = params.minRelevance ?? 0;

  let query = supabase
    .from("agent_memories")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .gte("relevance", minRelevance)
    .order("relevance", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (params.memoryType) query = query.eq("memory_type", params.memoryType);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list agent memories: ${error.message}`);
  return (data ?? []) as AgentMemoryRow[];
}

/**
 * Fetch a single memory by id, or null when no row matches (or when RLS
 * hides it).
 */
export async function getMemory(
  supabase: SupabaseClient,
  memoryId: string
): Promise<AgentMemoryRow | null> {
  const { data, error } = await supabase
    .from("agent_memories")
    .select("*")
    .eq("id", memoryId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load agent memory: ${error.message}`);
  return (data ?? null) as AgentMemoryRow | null;
}

/**
 * Stamp `last_used_at = now()` on a memory row to signal the agent pulled
 * it into a recent prompt. No-op (returns silently) when the row is
 * missing / hidden by RLS — "touch" is advisory, not a correctness gate.
 */
export async function touchMemory(
  supabase: SupabaseClient,
  memoryId: string
): Promise<void> {
  const { error } = await supabase
    .from("agent_memories")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", memoryId);

  if (error) throw new Error(`Failed to touch agent memory: ${error.message}`);
}
