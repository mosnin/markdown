export type InsightCategory = "fact" | "decision" | "insight" | "question" | "action";

export interface Insight {
  id: string;
  workspace_id: string;
  note_id: string;
  claim: string;
  category: InsightCategory;
  confidence: number;
  source_excerpt: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsightInput {
  workspace_id: string;
  note_id: string;
  claim: string;
  category: InsightCategory;
  confidence?: number;
  source_excerpt?: string | null;
}
