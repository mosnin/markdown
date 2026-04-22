export interface EntityMention {
  id: string;
  workspace_id: string;
  entity_id: string;
  note_id: string;
  surface_form: string;
  context: string | null;
  position_start: number | null;
  position_end: number | null;
  branch_id: string | null;
  created_at: string;
}

export interface EntityMentionInput {
  workspace_id: string;
  entity_id: string;
  note_id: string;
  surface_form: string;
  context?: string | null;
  position_start?: number | null;
  position_end?: number | null;
  branch_id?: string | null;
}
