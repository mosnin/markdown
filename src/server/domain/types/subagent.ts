export type SubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SubagentInvocation {
  id: string;
  workspace_id: string;
  parent_operator_run_id: string | null;
  skill_id: string;
  user_id: string | null;
  task: string;
  status: SubagentStatus;
  summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  tool_calls_count: number;
  input_tokens: number;
  output_tokens: number;
  modal_run_id: string | null;
  depth: number;
}

export interface SubagentInvocationInput {
  workspace_id: string;
  parent_operator_run_id?: string | null;
  skill_id: string;
  user_id?: string | null;
  task: string;
  depth?: number;
}

export interface SubagentInvocationUpdate {
  status?: SubagentStatus;
  summary?: string | null;
  error?: string | null;
  completed_at?: string | null;
  tool_calls_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  modal_run_id?: string | null;
}

/**
 * Slim shape returned to the orchestrator from list_skills_plugins.
 * Mirrors the fields a subagent-capable skill advertises for selection.
 */
export interface SkillPluginSummary {
  id: string;
  name: string;
  description: string | null;
  subagent_tools: string[] | null;
  subagent_max_turns: number | null;
}
