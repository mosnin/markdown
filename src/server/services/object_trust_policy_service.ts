import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Object trust policy service.
 *
 * Determines the effective trust level for any content object
 * (note, file, skill, agent) so that permission checks, machine workflow
 * cues, and proposal routing can share one coherent model.
 *
 * Trust levels:
 *   workspace_reusable — skill or agent with is_reusable=true
 *     - Higher trust, shared across boxes
 *     - External writes are proposal-only (no direct generation)
 *     - UI shows stricter messaging
 *
 *   box_local — note, file, or box-local skill/agent
 *     - Standard trust model
 *     - External writes follow the connection's permission_mode
 *     - Reusable-specific messaging not shown
 *
 * Permission rules:
 *   - read_only: any object may be read
 *   - propose_writes: may submit proposals for any object type
 *   - generate_in_allowed_folders: may directly create notes in
 *     pre-authorized folders; may propose writes on all object types;
 *     may NOT directly mutate reusable shared skills/agents (proposal required)
 *
 * Design notes:
 *   - This service reads object rows from the database.
 *   - It does NOT enforce ownership. Callers must verify ownership first.
 *   - It is safe to call from both server actions and API route handlers.
 */

export interface ObjectTrustPolicy {
  object_type: "note" | "file" | "skill" | "agent";
  object_id: string;
  trust_level: "workspace_reusable" | "box_local";
  is_reusable: boolean;
  /** External writes (machine proposals) require human review. Always true. */
  proposal_only_for_external: boolean;
  /**
   * true when this is a reusable shared object (is_reusable=true).
   * Signals stricter UI messaging and no direct generation.
   */
  is_shared: boolean;
  box_id: string | null;
  status: string;
}

/**
 * Fetch the trust policy for a note.
 * Notes are always box_local. Their external write rules depend on the
 * connection's permission_mode and folder policy.
 */
export async function getNoteTrustPolicy(
  supabase: SupabaseClient,
  noteId: string
): Promise<ObjectTrustPolicy | null> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, status, box_id")
    .eq("id", noteId)
    .single();

  if (error || !data) return null;

  const row = data as { id: string; status: string; box_id: string };

  return {
    object_type: "note",
    object_id: noteId,
    trust_level: "box_local",
    is_reusable: false,
    proposal_only_for_external: true,
    is_shared: false,
    box_id: row.box_id,
    status: row.status,
  };
}

/**
 * Fetch the trust policy for a file, skill, or agent.
 *
 * Skills and agents with is_reusable=true are workspace_reusable.
 * Files and box-local skills/agents are box_local.
 */
export async function getObjectTrustPolicy(
  supabase: SupabaseClient,
  objectType: "file" | "skill" | "agent",
  objectId: string
): Promise<ObjectTrustPolicy | null> {
  const table = objectType === "file" ? "files" : objectType === "skill" ? "skills" : "agents";

  const selectCols =
    objectType === "file"
      ? "id, status, box_id"
      : "id, status, box_id, is_reusable";

  const { data, error } = await supabase
    .from(table)
    .select(selectCols)
    .eq("id", objectId)
    .single();

  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    status: string;
    box_id: string | null;
    is_reusable?: boolean;
  };

  const is_reusable = row.is_reusable ?? false;
  const trust_level: ObjectTrustPolicy["trust_level"] =
    is_reusable ? "workspace_reusable" : "box_local";

  return {
    object_type: objectType,
    object_id: objectId,
    trust_level,
    is_reusable,
    proposal_only_for_external: true, // always true — all external writes go through proposals
    is_shared: is_reusable,
    box_id: row.box_id,
    status: row.status,
  };
}

/**
 * Check if an external connection is permitted to directly mutate an object
 * (i.e. without a proposal). Returns false for any object when the permission
 * model requires a proposal, which for reusable shared objects is always.
 *
 * Logic:
 *   - read_only: never permitted to write
 *   - propose_writes: never directly mutate, always proposal
 *   - generate_in_allowed_folders: may directly create notes in pre-authorized
 *     folders, but NEVER directly mutate reusable shared skills/agents
 *
 * This is the machine-facing trust gate. Human owners always retain direct edit.
 */
export function connectionCanDirectlyWrite(
  permissionMode: string,
  policy: ObjectTrustPolicy
): boolean {
  if (permissionMode === "read_only") return false;
  if (permissionMode === "propose_writes") return false;

  // generate_in_allowed_folders: only direct create for notes, not objects
  if (permissionMode === "generate_in_allowed_folders") {
    // Reusable shared objects always require proposals
    if (policy.is_shared) return false;
    // Object types (file/skill/agent) require proposals even when box-local
    // for predictability and auditability of the expanded object model.
    // Only notes in pre-authorized folders support direct generation.
    if (policy.object_type !== "note") return false;
    return true;
  }

  return false;
}

/**
 * Returns a human-readable description of the trust level for UI display.
 */
export function describeObjectTrustLevel(policy: ObjectTrustPolicy): {
  label: string;
  detail: string;
} {
  if (policy.trust_level === "workspace_reusable") {
    return {
      label: "Workspace shared",
      detail: "This object is shared across boxes. External writes require a proposal.",
    };
  }

  switch (policy.object_type) {
    case "note":
      return {
        label: "Box note",
        detail: "External writes go through the proposal queue for human review.",
      };
    case "file":
      return {
        label: "Box file",
        detail: "External writes go through the proposal queue for human review.",
      };
    case "skill":
      return {
        label: "Box skill",
        detail: "External writes go through the proposal queue for human review.",
      };
    case "agent":
      return {
        label: "Box agent",
        detail: "External writes go through the proposal queue for human review.",
      };
  }
}
