export type WebToolName =
  | "exa_search"
  | "tavily_search"
  | "web_fetch"
  | "browserbase_session"
  | "browserbase_step";

export interface WebToolUsage {
  id: string;
  workspace_id: string;
  user_id: string | null;
  tool_name: WebToolName;
  units: number;
  cost_cents: number;
  operator_run_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WebToolUsageInput {
  workspace_id: string;
  user_id?: string | null;
  tool_name: WebToolName;
  units?: number;
  cost_cents: number;
  operator_run_id?: string | null;
  metadata?: Record<string, unknown>;
}

export type BrowsingSessionStatus =
  | "active"
  | "completed"
  | "failed"
  | "timed_out";

export interface BrowsingSession {
  id: string;
  workspace_id: string;
  user_id: string;
  operator_run_id: string | null;
  browserbase_session_id: string;
  status: BrowsingSessionStatus;
  goal: string | null;
  live_url: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  page_count: number;
  total_cost_cents: number;
}

export type BrowsingStepAction =
  | "navigate"
  | "click"
  | "fill"
  | "extract"
  | "screenshot";

export interface BrowsingSessionStep {
  id: string;
  session_id: string;
  step_number: number;
  action: BrowsingStepAction;
  url: string | null;
  selector: string | null;
  value: string | null;
  extracted_content: string | null;
  screenshot_url: string | null;
  action_took_ms: number | null;
  created_at: string;
}

export type CitationSourceType = "exa" | "tavily" | "browserbase" | "web_fetch";

export interface WebCitation {
  id: string;
  workspace_id: string;
  operator_run_id: string | null;
  source_type: CitationSourceType;
  url: string;
  title: string | null;
  excerpt: string | null;
  fetched_at: string;
}
