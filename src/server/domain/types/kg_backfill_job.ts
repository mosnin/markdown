export type KgBackfillJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface KgBackfillJob {
  id: string;
  workspace_id: string;
  triggered_by: string | null;
  status: KgBackfillJobStatus;
  total_notes: number;
  processed_notes: number;
  failed_notes: number;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
