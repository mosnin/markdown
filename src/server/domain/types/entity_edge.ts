export type EntityEdgeType = "mentions" | "causes" | "decides" | "owns" | "relates_to" | "contradicts" | "supports" | "depends_on";

export interface EntityEdge {
  id: string;
  workspace_id: string;
  source_entity_id: string;
  target_entity_id: string;
  edge_type: EntityEdgeType;
  confidence: number;
  note_id: string | null;
  context: string | null;
  created_at: string;
}

export interface EntityEdgeInput {
  workspace_id: string;
  source_entity_id: string;
  target_entity_id: string;
  edge_type: EntityEdgeType;
  confidence?: number;
  note_id?: string | null;
  context?: string | null;
}
