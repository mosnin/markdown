export type EntityType = "person" | "project" | "concept" | "organization" | "event" | "decision" | "other";

export interface Entity {
  id: string;
  workspace_id: string;
  name: string;
  entity_type: EntityType;
  description: string | null;
  mention_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface EntityInput {
  workspace_id: string;
  name: string;
  entity_type: EntityType;
  description?: string | null;
}
