export type InlineCommandStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface InlineCommandInvocation {
  id: string;
  workspace_id: string;
  user_id: string;
  note_id: string;
  command_id: string;
  subagent_invocation_id: string | null;
  selection_start: number | null;
  selection_end: number | null;
  status: InlineCommandStatus;
  output: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Built-in slash commands. Each maps to a system prompt template the
 * Modal sub-agent runtime resolves via its `inline_command` namespace.
 *
 * User-defined skills with is_subagent=true appear in the same menu but
 * with command_id = `skill:<uuid>`.
 */
export type BuiltInCommandId =
  | "summarize"
  | "expand"
  | "translate"
  | "cite"
  | "outline"
  | "rewrite";

export interface InlineCommandDefinition {
  id: BuiltInCommandId;
  label: string;
  description: string;
  /** Default system prompt the Modal runtime applies for this command. */
  system_prompt: string;
  /** Hint text shown in the menu; keep short. */
  hint: string;
}

export const BUILT_IN_COMMANDS: InlineCommandDefinition[] = [
  {
    id: "summarize",
    label: "Summarize",
    description: "Condense the selected text (or full note) into 2–3 sentences.",
    system_prompt:
      "Summarise the provided context in 2–3 sentences. Preserve key entities and decisions. Output only the summary, no preamble.",
    hint: "2–3 sentence summary",
  },
  {
    id: "expand",
    label: "Expand",
    description: "Flesh out the current paragraph with more detail.",
    system_prompt:
      "Expand the provided context by adding specific details, supporting points, and examples. Keep the same voice. Output only the expanded text.",
    hint: "Add depth + examples",
  },
  {
    id: "translate",
    label: "Translate…",
    description: "Translate selection into a target language.",
    system_prompt:
      "Translate the provided text into the target language specified by the user. Preserve formatting. Output only the translation.",
    hint: "Target language prompted",
  },
  {
    id: "cite",
    label: "Add citations",
    description: "Find sources for claims in the current paragraph via web search.",
    system_prompt:
      "Identify factual claims in the provided text. For each, search the web (deep_search tool) for a supporting source. Output the original text with citation markers [1], [2]… and a References list at the end.",
    hint: "Grounded with web sources",
  },
  {
    id: "outline",
    label: "Outline",
    description: "Turn the note or selection into a hierarchical outline.",
    system_prompt:
      "Convert the provided text into a hierarchical markdown outline with bullet points. Preserve original meaning. Output only the outline.",
    hint: "Bulleted structure",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    description: "Rewrite the selection for clarity without changing meaning.",
    system_prompt:
      "Rewrite the provided text to improve clarity, concision, and flow. Do not change meaning or add new information. Output only the rewritten text.",
    hint: "Clearer, cleaner prose",
  },
];
