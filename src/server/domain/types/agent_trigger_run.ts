export type AgentTriggerRunStatus = "running" | "completed" | "failed" | "skipped";

export interface AgentTriggerRun {
  id: string;
  workspace_id: string;
  trigger_id: string;
  agent_id: string;
  status: AgentTriggerRunStatus;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  skip_reason: string | null;
  workspace_operator_run_id: string | null;
  created_at: string;
}
