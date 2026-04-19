"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  AGENT_TOOL_NAMES,
  DEFAULT_USER_AGENT_PREFERENCES,
  getUserAgentPreferences,
  upsertUserAgentPreferences,
  type AgentToolName,
  type AgentTone,
  type CitationStyle,
  type UserAgentPreferences,
} from "@/server/services/user_agent_preferences_service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface SaveUserAgentPreferencesInput {
  tone: AgentTone;
  citation_style: CitationStyle;
  tool_allowlist: AgentToolName[];
  must_cite_per_claim: boolean;
  max_tool_calls: number;
}

const TONE_VALUES: AgentTone[] = [
  "neutral",
  "formal",
  "casual",
  "technical",
  "friendly",
];
const CITATION_VALUES: CitationStyle[] = ["inline", "footnote", "endnote"];
const TOOL_NAME_SET = new Set<string>(AGENT_TOOL_NAMES);

/**
 * Persist the user's AI agent preferences. The DB CHECK constraints make
 * the table rejection-safe, but we revalidate here for fast user feedback
 * and to keep an unauthenticated caller from getting an opaque 500.
 */
export async function saveUserAgentPreferencesAction(
  input: SaveUserAgentPreferencesInput
): Promise<ActionResult<UserAgentPreferences>> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }

    if (!TONE_VALUES.includes(input.tone)) {
      return { ok: false, error: `Invalid tone: ${input.tone}` };
    }
    if (!CITATION_VALUES.includes(input.citation_style)) {
      return { ok: false, error: `Invalid citation style: ${input.citation_style}` };
    }
    if (!Array.isArray(input.tool_allowlist)) {
      return { ok: false, error: "tool_allowlist must be an array" };
    }
    const cleanedTools = Array.from(
      new Set(input.tool_allowlist.filter((t) => TOOL_NAME_SET.has(t)))
    ) as AgentToolName[];

    if (typeof input.max_tool_calls !== "number" || Number.isNaN(input.max_tool_calls)) {
      return { ok: false, error: "max_tool_calls must be a number" };
    }
    if (input.max_tool_calls < 1 || input.max_tool_calls > 100) {
      return { ok: false, error: "max_tool_calls must be between 1 and 100" };
    }

    const supabase = await createClient();
    const row = await upsertUserAgentPreferences(supabase, ctx.user.id, {
      tone: input.tone,
      citation_style: input.citation_style,
      tool_allowlist: cleanedTools,
      must_cite_per_claim: !!input.must_cite_per_claim,
      max_tool_calls: Math.floor(input.max_tool_calls),
    });

    revalidatePath("/app/settings");
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to save agent preferences.",
    };
  }
}

/**
 * Load the user's preferences for the settings card. Falls back to the
 * shipped defaults if the user has never saved.
 */
export async function loadUserAgentPreferencesAction(): Promise<
  ActionResult<{
    tone: AgentTone;
    citation_style: CitationStyle;
    tool_allowlist: AgentToolName[];
    must_cite_per_claim: boolean;
    max_tool_calls: number;
  }>
> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }

    const supabase = await createClient();
    const row = await getUserAgentPreferences(supabase, ctx.user.id);
    return {
      ok: true,
      data: {
        tone: row?.tone ?? DEFAULT_USER_AGENT_PREFERENCES.tone,
        citation_style:
          row?.citation_style ?? DEFAULT_USER_AGENT_PREFERENCES.citation_style,
        tool_allowlist: (row?.tool_allowlist ??
          DEFAULT_USER_AGENT_PREFERENCES.tool_allowlist) as AgentToolName[],
        must_cite_per_claim:
          row?.must_cite_per_claim ??
          DEFAULT_USER_AGENT_PREFERENCES.must_cite_per_claim,
        max_tool_calls:
          row?.max_tool_calls ?? DEFAULT_USER_AGENT_PREFERENCES.max_tool_calls,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to load agent preferences.",
    };
  }
}
