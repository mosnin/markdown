import { type SupabaseClient } from "@supabase/supabase-js";
import { type AuditEvent } from "@/server/domain/types/audit_event";
import { type ActorType } from "@/server/domain/constants/audit_constants";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Audit event repository.
 *
 * Design notes:
 * - AuditEvents are append-only and immutable — INSERT + SELECT only.
 * - No UPDATE or DELETE operations are provided.
 * - workspace_id scoping is enforced at the RLS level, but callers must
 *   always supply workspace_id for clarity and defense-in-depth.
 */

export interface CreateAuditEventInput {
  workspace_id: string;
  actor_type: ActorType;
  actor_id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  metadata?: Record<string, unknown> | null;
}

export async function createAuditEvent(
  supabase: SupabaseClient,
  input: CreateAuditEventInput
): Promise<AuditEvent> {
  const { data, error } = await supabase
    .from("audit_events")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new RepositoryError("createAuditEvent", error);
  return data as AuditEvent;
}

export async function listAuditEventsByWorkspace(
  supabase: SupabaseClient,
  workspace_id: string,
  {
    object_type,
    object_id,
    event_type,
    actor_type,
    limit = 100,
    offset = 0,
  }: {
    object_type?: string;
    object_id?: string;
    event_type?: string;
    actor_type?: ActorType;
    limit?: number;
    offset?: number;
  } = {}
): Promise<AuditEvent[]> {
  let query = supabase
    .from("audit_events")
    .select("*")
    .eq("workspace_id", workspace_id);

  if (object_type) query = query.eq("object_type", object_type);
  if (object_id) query = query.eq("object_id", object_id);
  if (event_type) query = query.eq("event_type", event_type);
  if (actor_type) query = query.eq("actor_type", actor_type);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return data as AuditEvent[];
}

export async function listAuditEventsForObject(
  supabase: SupabaseClient,
  object_type: string,
  object_id: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("*")
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return data as AuditEvent[];
}
