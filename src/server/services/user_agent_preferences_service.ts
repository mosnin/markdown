import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-user preferences governing how AI agents (currently the Workspace
 * Operator) behave for that user. One row per user, gated by self-only RLS.
 *
 * The defaults exported below are the source of truth shipped to UIs that
 * render the preferences card before the user has saved a row. They match
 * the column DEFAULT clauses in
 * `supabase/migrations/20260419000002_user_agent_preferences.sql`.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentTone =
  | "neutral"
  | "formal"
  | "casual"
  | "technical"
  | "friendly";

export type CitationStyle = "inline" | "footnote" | "endnote";

/**
 * The seven first-party agent tools recognized by the Workspace Operator.
 * The default allowlist contains all of them; users can opt tools out
 * via the settings card.
 */
export const AGENT_TOOL_NAMES = [
  "hybrid_search",
  "draft_note",
  "read_note",
  "edit_note",
  "link_notes",
  "apply_template",
  "web_fetch",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export interface UserAgentPreferences {
  user_id: string;
  tone: AgentTone;
  citation_style: CitationStyle;
  tool_allowlist: AgentToolName[];
  must_cite_per_claim: boolean;
  max_tool_calls: number;
  created_at: string;
  updated_at: string;
}

export interface UserAgentPreferencesPatch {
  tone?: AgentTone;
  citation_style?: CitationStyle;
  tool_allowlist?: AgentToolName[];
  must_cite_per_claim?: boolean;
  max_tool_calls?: number;
}

/**
 * Defaults shipped to clients before the user has saved a row. Matches the
 * column DEFAULT clauses in the table definition. `user_id`, `created_at`
 * and `updated_at` are intentionally absent — those only exist on a real
 * persisted row.
 */
export const DEFAULT_USER_AGENT_PREFERENCES: Omit<
  UserAgentPreferences,
  "user_id" | "created_at" | "updated_at"
> = {
  tone: "neutral",
  citation_style: "inline",
  tool_allowlist: [...AGENT_TOOL_NAMES],
  must_cite_per_claim: false,
  max_tool_calls: 20,
};

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * Returns the user's saved preferences row, or `null` if none exists yet.
 * Callers that need a guaranteed object should fall back to
 * {@link DEFAULT_USER_AGENT_PREFERENCES}.
 */
export async function getUserAgentPreferences(
  supabase: SupabaseClient,
  userId: string
): Promise<UserAgentPreferences | null> {
  const { data, error } = await supabase
    .from("user_agent_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load agent preferences: ${error.message}`);
  }
  return (data ?? null) as UserAgentPreferences | null;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Insert the user's preferences row if missing, otherwise update the
 * subset of columns explicitly named in `patch`. Returns the resulting
 * row.
 *
 * The `tool_allowlist` is stored as a Postgres `text[]`. We normalize
 * to a deduplicated array of valid tool names before write so a buggy
 * client can't sneak in unknown tools.
 */
export async function upsertUserAgentPreferences(
  supabase: SupabaseClient,
  userId: string,
  patch: UserAgentPreferencesPatch
): Promise<UserAgentPreferences> {
  const validToolSet = new Set<string>(AGENT_TOOL_NAMES);

  const payload: Record<string, unknown> = { user_id: userId };
  if (patch.tone !== undefined) payload.tone = patch.tone;
  if (patch.citation_style !== undefined) payload.citation_style = patch.citation_style;
  if (patch.tool_allowlist !== undefined) {
    const cleaned = Array.from(new Set(patch.tool_allowlist)).filter((t) =>
      validToolSet.has(t)
    );
    payload.tool_allowlist = cleaned;
  }
  if (patch.must_cite_per_claim !== undefined) {
    payload.must_cite_per_claim = patch.must_cite_per_claim;
  }
  if (patch.max_tool_calls !== undefined) {
    const clamped = Math.max(1, Math.min(100, Math.floor(patch.max_tool_calls)));
    payload.max_tool_calls = clamped;
  }

  const { data, error } = await supabase
    .from("user_agent_preferences")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to save agent preferences: ${error?.message ?? "unknown"}`
    );
  }
  return data as UserAgentPreferences;
}
