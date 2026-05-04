import type { PreferredAi } from "@/lib/preferred_ai";

/**
 * Single source of truth for the "Send to AI" copy lines.
 *
 * Both the `<SendToAiPopover/>` (Agent B) and the `/help/send-to-ai`
 * docs page (Agent D) format the same prompts. Keep this file pure —
 * no `'use client'`, no DOM, no React.
 */

/** Display label shown in the AI picker. */
export const AI_LABELS: Record<PreferredAi, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  "claude-web": "Claude Web",
  chatgpt: "ChatGPT",
  other: "Other",
};

/** AI surfaces that are MCP-savvy and prefer the `get_context_bundle` tool form. */
export const MCP_SAVVY_AIS: ReadonlySet<PreferredAi> = new Set([
  "claude-code",
  "cursor",
]);

export function isMcpSavvy(ai: PreferredAi): boolean {
  return MCP_SAVVY_AIS.has(ai);
}

/** Best-effort deep link per AI surface. Falls back to homepage when unknown. */
const AI_DEEP_LINKS: Record<PreferredAi, string> = {
  "claude-code": "https://claude.ai/code",
  cursor: "https://cursor.com",
  "claude-web": "https://claude.ai",
  chatgpt: "https://chat.openai.com",
  other: "https://www.google.com",
};

export function deepLinkForAi(ai: PreferredAi): string {
  return AI_DEEP_LINKS[ai] ?? AI_DEEP_LINKS.other;
}

export interface FormatPromptInput {
  ai: PreferredAi;
  objectType: "note" | "box" | "skill" | "agent" | "bundle";
  objectId: string;
  pullUrl: string;
  /**
   * Free-text question slot the user fills in inside their AI client.
   * Defaults to the literal placeholder `<YOUR QUESTION>` so the user
   * sees where to substitute.
   */
  questionPlaceholder?: string;
}

/**
 * The prompt line the user pastes into their chosen AI.
 *
 * - MCP-savvy clients (Claude Code, Cursor) get the structured tool
 *   invocation that drives the `poggle.get_context_bundle` MCP tool.
 * - Non-MCP clients (Claude Web, ChatGPT, Other) get the
 *   "Read this and use it as context" one-liner pointing at the
 *   public `.md` pull URL.
 */
export function formatPromptForAi(input: FormatPromptInput): string {
  const placeholder = input.questionPlaceholder ?? "<YOUR QUESTION>";
  if (isMcpSavvy(input.ai)) {
    return `Use poggle.get_context_bundle with ${input.objectType}_id=${input.objectId} to load full context, then help me with: ${placeholder}`;
  }
  return `Read this and use it as context for our conversation:\n\n${input.pullUrl}.md`;
}

/**
 * Bash one-liner shown in the "Or copy as bash:" disclosure. Keeps the
 * 50KB head trim in lockstep with the bundle size cap so the output
 * fits in any chat window's paste buffer.
 */
export function formatBashOneLiner(pullUrl: string): string {
  return `curl -s '${pullUrl}.md' | head -c 50000`;
}

/** Static MCP escalation hint used at the bottom of MCP-savvy popovers. */
export const MCP_ESCALATION_HINT =
  "Working with this regularly? Set up the MCP server once → never expires.";

/** Subtitle shown when "Allow edits" is checked. */
export const ALLOW_EDITS_NOTE =
  "Edits land as proposals — you approve before anything saves.";

/** Help link target — Agent D will own this docs page. */
export const HELP_MCP_HREF = "/help/send-to-ai#mcp";

/** Settings deep link — Agent C creates this tab. */
export const PULL_TOKENS_SETTINGS_HREF =
  "/app/settings/connected_apps?tab=pull-tokens";
