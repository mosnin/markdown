import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Change set service.
 *
 * The change_set table is the group correlation handle for every write
 * in Context Store. Services that mutate content (import, proposal
 * approval, move, rollback, manual edit, …) open a change set, accrue
 * items (content) and structural_events (tree shape), then finalize.
 * The grouped record is what the restore service undoes.
 *
 * Design invariants enforced here:
 *
 *   1. Change sets move open → committed → (aborted exits early). Never
 *      the other direction. This is why the table has CHECKed timestamp
 *      invariants.
 *   2. Items are immutable once written. There is no update / delete
 *      helper — mistakes are corrected by opening a compensating change
 *      set.
 *   3. Structural events carry a monotonic sequence within the change
 *      set so a restore can replay them LIFO.
 *   4. Audit events that belong to a grouped operation should set
 *      change_set_id so the audit layer renders the whole group as one
 *      history entry later.
 *
 * This module is deliberately schema-light. The jsonb snapshots use a
 * loose shape so each service writes the minimum state needed to undo
 * its own operation. The restore service is the schema authority for
 * what those snapshots must contain per object_type — see
 * restore_service.ts.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChangeSetOrigin =
  | "manual_edit"
  | "import"
  | "proposal_approval"
  | "structural_move"
  | "lifecycle"
  | "rollback"
  | "restore"
  | "branch_promotion"
  | "branch_promotion_partial"
  | "system";

export type ChangeSetStatus = "open" | "committed" | "aborted";

export type ChangeSetActorType = "user" | "connection" | "system";

export interface ChangeSet {
  id: string;
  workspace_id: string;
  origin: ChangeSetOrigin;
  actor_type: ChangeSetActorType;
  actor_id: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  parent_change_set_id: string | null;
  status: ChangeSetStatus;
  created_at: string;
  committed_at: string | null;
  aborted_at: string | null;
}

export type ChangeSetItemOperation =
  | "create"
  | "update"
  | "archive"
  | "unarchive"
  | "trash"
  | "restore_lifecycle"
  | "move"
  | "attach"
  | "detach"
  | "link_create"
  | "link_delete"
  | "rollback";

export type ChangeSetItemObjectType =
  | "note"
  | "file"
  | "skill"
  | "agent"
  | "folder"
  | "box"
  | "note_link"
  | "object_link"
  | "box_object_attachment";

export interface ChangeSetItem {
  id: string;
  change_set_id: string;
  workspace_id: string;
  operation: ChangeSetItemOperation;
  object_type: ChangeSetItemObjectType;
  object_id: string;
  version_id: string | null;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  created_at: string;
}

export type StructuralEventType =
  | "move"
  | "reorder"
  | "folder_rename"
  | "path_cascade"
  | "attach"
  | "detach"
  | "folder_create"
  | "folder_delete";

export type StructuralObjectType =
  | "note"
  | "file"
  | "skill"
  | "agent"
  | "folder"
  | "box_object_attachment";

export interface StructuralEvent {
  id: string;
  change_set_id: string;
  workspace_id: string;
  box_id: string | null;
  event_type: StructuralEventType;
  object_type: StructuralObjectType;
  object_id: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  sequence: number;
  created_at: string;
}

// ─── Open / commit / abort ───────────────────────────────────────────────────

export interface OpenChangeSetInput {
  workspace_id: string;
  origin: ChangeSetOrigin;
  actor_type: ChangeSetActorType;
  actor_id: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  parent_change_set_id?: string | null;
}

export async function openChangeSet(
  supabase: SupabaseClient,
  input: OpenChangeSetInput
): Promise<ChangeSet> {
  const { data, error } = await supabase
    .from("change_sets")
    .insert({
      workspace_id: input.workspace_id,
      origin: input.origin,
      actor_type: input.actor_type,
      actor_id: input.actor_id,
      summary: input.summary ?? null,
      metadata: input.metadata ?? {},
      parent_change_set_id: input.parent_change_set_id ?? null,
      status: "open",
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to open change set");
  }
  return data as ChangeSet;
}

/**
 * Move an open change set to committed. No-op if already committed (by
 * design — services can call this from a finally block). Throws on any
 * state other than open / committed.
 */
export async function commitChangeSet(
  supabase: SupabaseClient,
  changeSetId: string
): Promise<void> {
  const { data: current } = await supabase
    .from("change_sets")
    .select("status")
    .eq("id", changeSetId)
    .maybeSingle();
  if (!current) throw new Error("Change set not found");
  if (current.status === "committed") return;
  if (current.status !== "open") {
    throw new Error(`Cannot commit change set in status '${current.status}'`);
  }
  const { error } = await supabase
    .from("change_sets")
    .update({ status: "committed", committed_at: new Date().toISOString() })
    .eq("id", changeSetId)
    .eq("status", "open"); // compare-and-swap guard against races
  if (error) throw new Error(error.message);
}

/** Mark a change set aborted. Safe to call multiple times. */
export async function abortChangeSet(
  supabase: SupabaseClient,
  changeSetId: string,
  reason?: string
): Promise<void> {
  const { data: current } = await supabase
    .from("change_sets")
    .select("status, metadata")
    .eq("id", changeSetId)
    .maybeSingle();
  if (!current) return; // best-effort abort in a finally block
  if (current.status !== "open") return;

  const metadata = {
    ...(current.metadata as Record<string, unknown> | null ?? {}),
    ...(reason ? { abort_reason: reason } : {}),
  };
  await supabase
    .from("change_sets")
    .update({
      status: "aborted",
      aborted_at: new Date().toISOString(),
      metadata,
    })
    .eq("id", changeSetId)
    .eq("status", "open");
}

// ─── Item recording ──────────────────────────────────────────────────────────

export interface RecordItemInput {
  change_set_id: string;
  workspace_id: string;
  operation: ChangeSetItemOperation;
  object_type: ChangeSetItemObjectType;
  object_id: string;
  version_id?: string | null;
  before_snapshot?: Record<string, unknown> | null;
  after_snapshot?: Record<string, unknown> | null;
}

export async function recordChangeSetItem(
  supabase: SupabaseClient,
  input: RecordItemInput
): Promise<ChangeSetItem> {
  const { data, error } = await supabase
    .from("change_set_items")
    .insert({
      change_set_id: input.change_set_id,
      workspace_id: input.workspace_id,
      operation: input.operation,
      object_type: input.object_type,
      object_id: input.object_id,
      version_id: input.version_id ?? null,
      before_snapshot: input.before_snapshot ?? null,
      after_snapshot: input.after_snapshot ?? null,
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to record change set item");
  }
  return data as ChangeSetItem;
}

export async function recordChangeSetItemsBatch(
  supabase: SupabaseClient,
  items: RecordItemInput[]
): Promise<void> {
  if (items.length === 0) return;
  const rows = items.map((i) => ({
    change_set_id: i.change_set_id,
    workspace_id: i.workspace_id,
    operation: i.operation,
    object_type: i.object_type,
    object_id: i.object_id,
    version_id: i.version_id ?? null,
    before_snapshot: i.before_snapshot ?? null,
    after_snapshot: i.after_snapshot ?? null,
  }));
  const { error } = await supabase.from("change_set_items").insert(rows);
  if (error) throw new Error(error.message ?? "Failed to batch-record change set items");
}

// ─── Structural event recording ──────────────────────────────────────────────

export interface RecordStructuralInput {
  change_set_id: string;
  workspace_id: string;
  box_id?: string | null;
  event_type: StructuralEventType;
  object_type: StructuralObjectType;
  object_id: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  sequence?: number;
}

export async function recordStructuralEvent(
  supabase: SupabaseClient,
  input: RecordStructuralInput
): Promise<StructuralEvent> {
  // If the caller didn't assign a sequence, pick the next one for this
  // change set. This is a best-effort numbering — concurrent writers in
  // the same change set could race, but change sets are meant to be
  // filled by a single server-action flow. Ordering is still meaningful
  // within a single flow.
  let seq = input.sequence ?? 0;
  if (input.sequence === undefined) {
    const { data: latest } = await supabase
      .from("structural_events")
      .select("sequence")
      .eq("change_set_id", input.change_set_id)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    seq = (latest?.sequence ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("structural_events")
    .insert({
      change_set_id: input.change_set_id,
      workspace_id: input.workspace_id,
      box_id: input.box_id ?? null,
      event_type: input.event_type,
      object_type: input.object_type,
      object_id: input.object_id,
      before_state: input.before_state,
      after_state: input.after_state,
      sequence: seq,
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to record structural event");
  }
  return data as StructuralEvent;
}

// ─── Read helpers ────────────────────────────────────────────────────────────

export async function getChangeSet(
  supabase: SupabaseClient,
  id: string
): Promise<ChangeSet | null> {
  const { data } = await supabase
    .from("change_sets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ChangeSet | null) ?? null;
}

export async function listChangeSetItems(
  supabase: SupabaseClient,
  changeSetId: string
): Promise<ChangeSetItem[]> {
  const { data } = await supabase
    .from("change_set_items")
    .select("*")
    .eq("change_set_id", changeSetId)
    .order("created_at", { ascending: true });
  return (data ?? []) as ChangeSetItem[];
}

export async function listStructuralEvents(
  supabase: SupabaseClient,
  changeSetId: string
): Promise<StructuralEvent[]> {
  const { data } = await supabase
    .from("structural_events")
    .select("*")
    .eq("change_set_id", changeSetId)
    .order("sequence", { ascending: true });
  return (data ?? []) as StructuralEvent[];
}

export async function listChangeSetsForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  { limit = 50, origin }: { limit?: number; origin?: ChangeSetOrigin } = {}
): Promise<ChangeSet[]> {
  let q = supabase
    .from("change_sets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (origin) q = q.eq("origin", origin);
  const { data } = await q;
  return (data ?? []) as ChangeSet[];
}

// ─── Planning helpers (pure) ────────────────────────────────────────────────
//
// These live in the service module so the restore service can reuse them
// and so tests can drive them without a live database.

/**
 * Return the inverse operation a restore should perform to undo `op`.
 * Some operations are their own inverse (move undoes via another move);
 * the restore service uses this as a hint, not a full plan.
 */
export function inverseOperation(op: ChangeSetItemOperation): ChangeSetItemOperation {
  switch (op) {
    case "create":            return "trash";
    case "update":            return "update";
    case "archive":           return "unarchive";
    case "unarchive":         return "archive";
    case "trash":             return "restore_lifecycle";
    case "restore_lifecycle": return "trash";
    case "move":              return "move";
    case "attach":            return "detach";
    case "detach":            return "attach";
    case "link_create":       return "link_delete";
    case "link_delete":       return "link_create";
    case "rollback":          return "rollback";
  }
}

/**
 * Return the inverse structural event descriptor for `event`. Callers
 * use this to synthesize the undo structural event when a restore
 * replays history LIFO.
 */
export function inverseStructuralEvent(
  event: StructuralEvent
): { event_type: StructuralEventType; before: Record<string, unknown>; after: Record<string, unknown> } {
  return {
    event_type: event.event_type,   // type stays the same; the inverse is before↔after
    before: event.after_state,
    after: event.before_state,
  };
}
