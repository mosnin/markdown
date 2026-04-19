export interface OperatorPlanStep {
  index: number;
  description: string;
  tool: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface OperatorPlan {
  run_id: string;
  steps: OperatorPlanStep[];
  summary: string;
}

export type OperatorRunPhase =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export interface OperatorProgressEvent {
  run_id: string;
  type:
    | "plan_ready"
    | "step_start"
    | "step_complete"
    | "tool_call"
    | "note_drafted"
    | "completed"
    | "failed";
  step_index?: number;
  detail?: string;
  timestamp: string;
}
