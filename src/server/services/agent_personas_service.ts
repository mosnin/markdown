import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Agent personas — named agent configurations for the V3 agent harness.
 *
 * The table is partitioned into two scopes:
 *
 *   * global rows     — `workspace_id IS NULL`, `is_system = true`, seeded
 *                       by the migration. Readable by every workspace.
 *   * workspace rows  — `workspace_id` set, `is_system = false`, authored
 *                       by workspace admins. Overrides a global slug when
 *                       both exist for the same slug.
 *
 * Override resolution: `getPersonaBySlug` returns the workspace row when
 * one exists for the slug, otherwise the global row. We order by
 * `workspace_id` DESC NULLS LAST and take the first — NULL sorts after
 * concrete values, so the workspace row wins.
 *
 * Mutation rules: user-authored rows require a non-null `workspace_id` and
 * `is_system=false`. The update / delete helpers do a pre-check SELECT to
 * refuse edits on system rows and surface a clean error before the UPDATE
 * would silently affect zero rows.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentPersonaRow {
  id: string;
  workspace_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  tool_allowlist: string[];
  model: string | null;
  max_turns: number | null;
  requires_approval: boolean;
  plan_first: boolean;
  must_cite_per_claim: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePersonaInput {
  /** Required for user-authored personas. Global/system rows are inserted by the migration. */
  workspaceId: string;
  slug: string;
  name: string;
  description?: string | null;
  systemPrompt?: string | null;
  toolAllowlist: string[];
  model?: string | null;
  /** 1..200 or null (unbounded). */
  maxTurns?: number | null;
  requiresApproval?: boolean;
  planFirst?: boolean;
  mustCitePerClaim?: boolean;
}

export interface UpdatePersonaPatch {
  slug?: string;
  name?: string;
  description?: string | null;
  systemPrompt?: string | null;
  toolAllowlist?: string[];
  model?: string | null;
  maxTurns?: number | null;
  requiresApproval?: boolean;
  planFirst?: boolean;
  mustCitePerClaim?: boolean;
}

const SLUG_PATTERN = /^[a-z0-9_-]{2,40}$/;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Return the personas visible to a workspace — all globals plus any
 * workspace-specific overrides. Workspace rows sort before globals, then
 * alphabetically by name.
 */
export async function listPersonasForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<AgentPersonaRow[]> {
  const { data, error } = await supabase
    .from("agent_personas")
    .select("*")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    // workspace_id DESC NULLS LAST → concrete ws rows come before NULL/global.
    .order("workspace_id", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list agent personas: ${error.message}`);
  }
  return (data ?? []) as AgentPersonaRow[];
}

/**
 * Resolve a persona slug for a workspace, preferring a workspace-specific
 * row over the global row. Returns null when neither exists.
 *
 * Uses a single query with `workspace_id DESC NULLS LAST` ordering plus
 * LIMIT 1 so the workspace row (if any) wins.
 */
export async function getPersonaBySlug(
  supabase: SupabaseClient,
  workspaceId: string,
  slug: string
): Promise<AgentPersonaRow | null> {
  const { data, error } = await supabase
    .from("agent_personas")
    .select("*")
    .eq("slug", slug)
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .order("workspace_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load agent persona by slug: ${error.message}`);
  }
  return (data ?? null) as AgentPersonaRow | null;
}

/**
 * Fetch a persona by id, or null when not found / RLS hides it.
 */
export async function getPersonaById(
  supabase: SupabaseClient,
  personaId: string
): Promise<AgentPersonaRow | null> {
  const { data, error } = await supabase
    .from("agent_personas")
    .select("*")
    .eq("id", personaId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load agent persona: ${error.message}`);
  }
  return (data ?? null) as AgentPersonaRow | null;
}

/**
 * Create a workspace-scoped persona. Always sets `is_system = false` —
 * system personas are only ever created by the migration seed.
 *
 * Validates the slug pattern (^[a-z0-9_-]{2,40}$) and name length (1..80)
 * before firing the INSERT.
 */
export async function createPersona(
  supabase: SupabaseClient,
  input: CreatePersonaInput
): Promise<AgentPersonaRow> {
  if (!SLUG_PATTERN.test(input.slug)) {
    throw new Error(
      `Persona slug invalid: "${input.slug}" (expected ^[a-z0-9_-]{2,40}$)`
    );
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new Error(
      `Persona name length out of range: ${name.length} (expected 1..80)`
    );
  }
  if (
    input.maxTurns !== undefined &&
    input.maxTurns !== null &&
    (input.maxTurns < 1 || input.maxTurns > 200)
  ) {
    throw new Error(
      `Persona max_turns out of range: ${input.maxTurns} (expected 1..200 or null)`
    );
  }

  const payload: Record<string, unknown> = {
    workspace_id: input.workspaceId,
    slug: input.slug,
    name,
    tool_allowlist: input.toolAllowlist,
    requires_approval: input.requiresApproval ?? false,
    plan_first: input.planFirst ?? false,
    must_cite_per_claim: input.mustCitePerClaim ?? false,
    is_system: false,
  };
  if (input.description !== undefined) payload.description = input.description;
  if (input.systemPrompt !== undefined) payload.system_prompt = input.systemPrompt;
  if (input.model !== undefined) payload.model = input.model;
  if (input.maxTurns !== undefined) payload.max_turns = input.maxTurns;

  const { data, error } = await supabase
    .from("agent_personas")
    .insert(payload)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create agent persona: ${error?.message ?? "unknown"}`);
  }
  return data as AgentPersonaRow;
}

/**
 * Apply a partial update. Refuses to touch rows where `is_system = true`
 * via a pre-check SELECT so callers get a clean error rather than a
 * silent zero-row UPDATE.
 */
export async function updatePersona(
  supabase: SupabaseClient,
  personaId: string,
  patch: UpdatePersonaPatch
): Promise<AgentPersonaRow> {
  const existing = await getPersonaById(supabase, personaId);
  if (!existing) throw new Error("Agent persona not found");
  if (existing.is_system) {
    throw new Error("Cannot edit system persona");
  }

  const update: Record<string, unknown> = {};

  if (patch.slug !== undefined) {
    if (!SLUG_PATTERN.test(patch.slug)) {
      throw new Error(
        `Persona slug invalid: "${patch.slug}" (expected ^[a-z0-9_-]{2,40}$)`
      );
    }
    update.slug = patch.slug;
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw new Error(
        `Persona name length out of range: ${name.length} (expected 1..80)`
      );
    }
    update.name = name;
  }
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.systemPrompt !== undefined) update.system_prompt = patch.systemPrompt;
  if (patch.toolAllowlist !== undefined) update.tool_allowlist = patch.toolAllowlist;
  if (patch.model !== undefined) update.model = patch.model;
  if (patch.maxTurns !== undefined) {
    if (
      patch.maxTurns !== null &&
      (patch.maxTurns < 1 || patch.maxTurns > 200)
    ) {
      throw new Error(
        `Persona max_turns out of range: ${patch.maxTurns} (expected 1..200 or null)`
      );
    }
    update.max_turns = patch.maxTurns;
  }
  if (patch.requiresApproval !== undefined) {
    update.requires_approval = patch.requiresApproval;
  }
  if (patch.planFirst !== undefined) update.plan_first = patch.planFirst;
  if (patch.mustCitePerClaim !== undefined) {
    update.must_cite_per_claim = patch.mustCitePerClaim;
  }

  if (Object.keys(update).length === 0) {
    return existing;
  }

  const { data, error } = await supabase
    .from("agent_personas")
    .update(update)
    .eq("id", personaId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update agent persona: ${error?.message ?? "unknown"}`);
  }
  return data as AgentPersonaRow;
}

/**
 * Delete a persona. Refuses system rows via a pre-check SELECT so callers
 * get a clean error rather than a silent zero-row DELETE.
 */
export async function deletePersona(
  supabase: SupabaseClient,
  personaId: string
): Promise<void> {
  const existing = await getPersonaById(supabase, personaId);
  if (!existing) throw new Error("Agent persona not found");
  if (existing.is_system) {
    throw new Error("Cannot delete system persona");
  }

  const { error } = await supabase
    .from("agent_personas")
    .delete()
    .eq("id", personaId);

  if (error) {
    throw new Error(`Failed to delete agent persona: ${error.message}`);
  }
}
