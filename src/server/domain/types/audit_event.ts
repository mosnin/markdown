import { type ActorType } from "../constants/audit_constants";

/**
 * Domain type: AuditEvent
 *
 * An append-only, immutable event record. Never mutated after creation.
 *
 * object_type: entity kind string (e.g. 'note', 'box', 'connection')
 * object_id:   entity's uuid as text
 * event_type:  dot-separated label (e.g. 'note.created', 'box.archived')
 * metadata:    structured detail relevant to this specific event type
 */
export interface AuditEvent {
  id: string;
  workspace_id: string;
  actor_type: ActorType;
  actor_id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
