import { type SupabaseClient } from "@supabase/supabase-js";
import {
  createObjectVersion,
  getLatestObjectVersion,
} from "@/server/repositories/object_version_repository";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import {
  upsertBranchHead,
  resolveBranchVersion,
} from "./branch_service";

/**
 * Branch-aware write helper for files / skills / agents.
 *
 * Shape identical to `updateNoteOnBranch` in `note_service.ts`:
 *
 *   * Writes a new immutable `object_versions` row.
 *   * Upserts `branch_heads` for (branch, object_type, object_id).
 *   * Does NOT mutate the canonical `files` / `skills` / `agents`
 *     row. Main's `current_version_id` stays put until promote.
 *
 * Non-versioned fields on main (name, description, tags, is_reusable,
 * etc.) are untouched by branch writes — they are not part of the
 * versioned content contract. Promotion advances `current_version_id`
 * (and mirrors `source_content` + `content_bytes` on the canonical
 * row, consistent with the Notes promote path).
 *
 * Audit fires a distinct event name per object type
 * (`file.branch_updated`, `skill.branch_updated`,
 * `agent.branch_updated`) so main edits and branch edits are easy
 * to filter in the Audit Log.
 */

export type VersionedObjectType = "file" | "skill" | "agent";

export interface UpdateObjectOnBranchInput {
  sourceContent: string;
}

export interface BranchObjectUpdateResult {
  version_id: string;
  version_number: number;
  branch_id: string;
  object_type: VersionedObjectType;
  object_id: string;
}

/**
 * Write a new branch version for the given content object and move
 * the branch head. Throws if the branch is not open or belongs to a
 * different workspace.
 *
 * Ownership check: the object is looked up and its `workspace_id` is
 * compared to the caller's. Trashed objects are rejected — branches
 * can't edit trashed content.
 */
export async function updateObjectContentOnBranch(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  branchId: string,
  objectType: VersionedObjectType,
  objectId: string,
  input: UpdateObjectOnBranchInput
): Promise<BranchObjectUpdateResult> {
  const table =
    objectType === "file" ? "files" :
    objectType === "skill" ? "skills" : "agents";

  // Ownership gate. Also captures the row's current_version_id so we
  // can set parent_version_id correctly on the new version.
  const { data: row } = await supabase
    .from(table)
    .select("id, workspace_id, status, current_version_id")
    .eq("id", objectId)
    .maybeSingle();
  if (!row) throw new Error(`${objectType} not found`);
  if (row.workspace_id !== workspaceId) throw new Error(`${objectType} not found`);
  if (row.status === "trashed") throw new Error(`Cannot edit a trashed ${objectType}`);

  // Branch must exist, belong to this workspace, and still be open.
  const { data: branch } = await supabase
    .from("draft_branches")
    .select("id, workspace_id, status")
    .eq("id", branchId)
    .maybeSingle();
  if (!branch || branch.workspace_id !== workspaceId || branch.status !== "open") {
    throw new Error("Branch not found or not open");
  }

  // Parent lineage: prefer the current branch head, fall back to
  // main's current_version_id. This keeps the version graph total —
  // a branch head's parent is either its previous branch head or the
  // exact main version the branch forked from.
  const branchHeadVersionId = await resolveBranchVersion(
    supabase,
    branchId,
    objectType,
    objectId
  );
  const parentVersionId = branchHeadVersionId ?? row.current_version_id ?? null;

  // version_number is monotonic across main + branch versions for
  // this object, matching the Notes convention. The planner and
  // restore engine don't care whether a version is "on a branch" —
  // they walk by parent_version_id and change_set_id tags.
  const latest = await getLatestObjectVersion(supabase, objectType, objectId);
  const nextVersionNumber = (latest?.version_number ?? 0) + 1;
  const contentBytes = Buffer.byteLength(input.sourceContent, "utf8");

  const version = await createObjectVersion(supabase, {
    object_type: objectType,
    object_id: objectId,
    parent_version_id: parentVersionId,
    version_number: nextVersionNumber,
    source_content: input.sourceContent,
    content_bytes: contentBytes,
    actor_type: "user",
    actor_id: userId,
    change_origin: "human_edit",
    diff_summary: {
      branch_id: branchId,
      branch_write: true,
    },
  });

  await upsertBranchHead(supabase, {
    branch_id: branchId,
    object_type: objectType,
    object_id: objectId,
    version_id: version.id,
  });

  // Distinct audit event keeps main edits and branch edits filterable.
  await createAuditEvent(supabase, {
    workspace_id: workspaceId,
    actor_type: "user",
    actor_id: userId,
    object_type: objectType,
    object_id: objectId,
    event_type: `${objectType}.branch_updated`,
    metadata: {
      branch_id: branchId,
      version_id: version.id,
      version_number: version.version_number,
    },
  });

  return {
    version_id: version.id,
    version_number: version.version_number,
    branch_id: branchId,
    object_type: objectType,
    object_id: objectId,
  };
}

/**
 * Branch-aware read helper. Returns the branch-head version row for
 * this object if one exists; returns null otherwise so the caller
 * can fall back to main. This is the identical pattern Notes use;
 * exposing it as a shared helper avoids per-type duplication.
 */
export async function resolveBranchObjectVersion(
  supabase: SupabaseClient,
  branchId: string | null | undefined,
  objectType: VersionedObjectType,
  objectId: string
): Promise<{
  id: string;
  source_content: string;
  content_bytes: number;
  version_number: number;
} | null> {
  if (!branchId) return null;
  const versionId = await resolveBranchVersion(
    supabase,
    branchId,
    objectType,
    objectId
  );
  if (!versionId) return null;
  const { data } = await supabase
    .from("object_versions")
    .select("id, source_content, content_bytes, version_number")
    .eq("id", versionId)
    .maybeSingle();
  return (data as {
    id: string;
    source_content: string;
    content_bytes: number;
    version_number: number;
  } | null) ?? null;
}
