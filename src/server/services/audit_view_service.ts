import { type SupabaseClient } from "@supabase/supabase-js";
import { type AuditEvent } from "@/server/domain/types/audit_event";
import { listAuditEventsByWorkspace } from "@/server/repositories/audit_event_repository";
import { type ActorType } from "@/server/domain/constants/audit_constants";

/**
 * Audit view service.
 *
 * Read-only facade over the audit_events table for the human audit browsing
 * surface. All queries are workspace-scoped. The caller is responsible for
 * ensuring the workspace belongs to the authenticated user.
 *
 * This service does not write events — writes go through audit_service.ts.
 */

export interface AuditFilter {
  actor_type?: ActorType;
  object_type?: string;
  event_type?: string;
  /**
   * Match any of the listed event types. Mutually exclusive with
   * `event_type`; supplying both keeps `event_type` (single match).
   * Used by the audit page to apply a "Pull links" chip that filters
   * to the small known set of pull-token event types.
   */
  event_types?: readonly string[];
  limit?: number;
  page?: number;
}

export interface AuditViewResult {
  events: AuditEvent[];
  limit: number;
  page: number;
  total_fetched: number;
}

/** Well-known object types for UI filter options. */
export const AUDIT_OBJECT_TYPES = [
  "note",
  "file",
  "skill",
  "agent",
  "folder",
  "box",
  "write_proposal",
  "connection",
  "note_link",
] as const;

/** Well-known event type groups for UI filter options. */
export const AUDIT_EVENT_GROUPS: Array<{ label: string; prefix: string }> = [
  { label: "Note edits", prefix: "note." },
  { label: "File changes", prefix: "file." },
  { label: "Skill changes", prefix: "skill." },
  { label: "Agent changes", prefix: "agent." },
  { label: "Lifecycle", prefix: "note.archived" },
  { label: "Object lifecycle", prefix: "file.archived" },
  { label: "Proposals", prefix: "write_proposal." },
  { label: "Connections", prefix: "connection." },
  { label: "Imports & exports", prefix: "import." },
];

export async function listWorkspaceAuditEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  filter: AuditFilter = {}
): Promise<AuditViewResult> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const events = await listAuditEventsByWorkspace(supabase, workspaceId, {
    actor_type: filter.actor_type,
    object_type: filter.object_type,
    event_type: filter.event_type,
    event_types: filter.event_types,
    limit,
    offset,
  });

  return {
    events,
    limit,
    page,
    total_fetched: events.length,
  };
}
