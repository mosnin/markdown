export type WorkflowStatus = "draft" | "active" | "archived";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowNodeType =
  | "start"
  | "subagent"
  | "web_search"
  | "web_fetch"
  | "transform"
  | "condition"
  | "merge"
  | "end";

export type WorkflowNodeRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_key: string;
  node_type: WorkflowNodeType;
  position: WorkflowNodePosition;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  label: string | null;
}

export interface Workflow {
  id: string;
  workspace_id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  trigger_id: string | null;
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workspace_id: string;
  user_id: string | null;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  total_cost_cents: number;
}

export interface WorkflowNodeRun {
  id: string;
  workflow_run_id: string;
  node_id: string;
  status: WorkflowNodeRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  subagent_invocation_id: string | null;
}

/**
 * Input shape for a node when saving a workflow graph. The client does not
 * know db ids for nodes yet, so we key by node_key and assign fresh ids
 * server-side when missing.
 */
export interface WorkflowGraphNodeInput {
  id?: string;
  node_key: string;
  node_type: WorkflowNodeType;
  position: WorkflowNodePosition;
  config: Record<string, unknown>;
}

/**
 * Input shape for an edge when saving a workflow graph. Source/target are
 * referenced by node_key (not db id) since nodes may not be persisted yet.
 */
export interface WorkflowGraphEdgeInput {
  id?: string;
  source_node_key: string;
  target_node_key: string;
  source_handle?: string | null;
  label?: string | null;
}

/** Shape used when saving — graph comes in, server inserts/updates rows. */
export interface WorkflowGraphInput {
  nodes: WorkflowGraphNodeInput[];
  edges: WorkflowGraphEdgeInput[];
}

// ─── Per-node-type config interfaces ──────────────────────────────────────

export interface SubagentNodeConfig {
  skill_id: string;
  task_template: string;
}

export interface WebSearchNodeConfig {
  query_template: string;
  provider: "exa" | "tavily";
  num_results: number;
}

export interface WebFetchNodeConfig {
  url_template: string;
}

export interface TransformNodeConfig {
  system_prompt: string;
  user_prompt_template: string;
  model?: string;
}

export interface ConditionNodeConfig {
  expression: string;
}

// start / merge / end have empty configs.
export type StartNodeConfig = Record<string, never>;
export type MergeNodeConfig = Record<string, never>;
export type EndNodeConfig = Record<string, never>;
