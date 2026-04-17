import { type SupabaseClient } from "@supabase/supabase-js";
import { listBranchHeads, type BranchHeadObjectType } from "./branch_service";

/**
 * Branch conflict detection service.
 *
 * Detects version conflicts between a draft branch and main. A conflict
 * exists when the canonical object's `current_version_id` has moved
 * past the version the branch originally forked from (the branch
 * head's `parent_version_id`). This means both main and the branch
 * modified the same object since the branch was created.
 *
 * The three-way view (base / main / branch) powers the resolution UI
 * so users can make informed keep/discard/rebase decisions per object.
 */

export interface BranchConflict {
  objectType: BranchHeadObjectType;
  objectId: string;
  mainVersionId: string;
  branchVersionId: string;
  /** The version the branch originally forked from (parent of the branch head). */
  branchParentVersionId: string;
  mainContent: string | null;
  branchContent: string | null;
  /** Content at the fork point — the common ancestor for 3-way comparison. */
  baseContent: string | null;
  displayName: string;
}

/**
 * Detect every version conflict between a branch and main.
 *
 * For each `branch_heads` row:
 *   1. Load the branch version and its `parent_version_id` (the base).
 *   2. Load the canonical object's `current_version_id` (main head).
 *   3. If main's head differs from the branch's parent AND from the
 *      branch head itself, there's a conflict — main moved ahead.
 *   4. Load the base version's content for the 3-way view.
 *
 * Returns only conflicting objects. An empty array means no conflicts.
 */
export async function detectConflicts(
  supabase: SupabaseClient,
  branchId: string
): Promise<BranchConflict[]> {
  const heads = await listBranchHeads(supabase, branchId);
  if (heads.length === 0) return [];

  const conflicts = await Promise.all(
    heads.map((h) => detectSingleConflict(supabase, h.object_type, h.object_id, h.version_id))
  );
  return conflicts.filter((c): c is BranchConflict => c !== null);
}

async function detectSingleConflict(
  supabase: SupabaseClient,
  objectType: BranchHeadObjectType,
  objectId: string,
  branchVersionId: string
): Promise<BranchConflict | null> {
  if (objectType === "note") {
    return detectNoteConflict(supabase, objectId, branchVersionId);
  }
  // file / skill / agent share the object_versions table.
  return detectObjectConflict(supabase, objectType, objectId, branchVersionId);
}

async function detectNoteConflict(
  supabase: SupabaseClient,
  objectId: string,
  branchVersionId: string
): Promise<BranchConflict | null> {
  const [{ data: main }, { data: branchVer }] = await Promise.all([
    supabase
      .from("notes")
      .select("id, title, markdown_content, current_version_id")
      .eq("id", objectId)
      .maybeSingle(),
    supabase
      .from("note_versions")
      .select("id, parent_version_id, markdown_content")
      .eq("id", branchVersionId)
      .maybeSingle(),
  ]);

  if (!main || !branchVer) return null;

  const mainVersionId = main.current_version_id as string | null;
  const parentVersionId = branchVer.parent_version_id as string | null;

  // No conflict if main hasn't moved past the branch's fork point.
  if (!mainVersionId || !parentVersionId) return null;
  if (mainVersionId === parentVersionId || mainVersionId === branchVersionId) return null;

  // Load the base version (fork point) content for 3-way view.
  const { data: baseVer } = await supabase
    .from("note_versions")
    .select("markdown_content")
    .eq("id", parentVersionId)
    .maybeSingle();

  return {
    objectType: "note",
    objectId,
    mainVersionId,
    branchVersionId,
    branchParentVersionId: parentVersionId,
    mainContent: main.markdown_content as string | null,
    branchContent: branchVer.markdown_content as string | null,
    baseContent: (baseVer?.markdown_content as string | null) ?? null,
    displayName: (main.title as string) ?? "(deleted note)",
  };
}

async function detectObjectConflict(
  supabase: SupabaseClient,
  objectType: BranchHeadObjectType,
  objectId: string,
  branchVersionId: string
): Promise<BranchConflict | null> {
  const table =
    objectType === "file" ? "files" :
    objectType === "skill" ? "skills" : "agents";

  const [{ data: main }, { data: branchVer }] = await Promise.all([
    supabase
      .from(table)
      .select("id, name, source_content, current_version_id")
      .eq("id", objectId)
      .maybeSingle(),
    supabase
      .from("object_versions")
      .select("id, parent_version_id, source_content")
      .eq("id", branchVersionId)
      .maybeSingle(),
  ]);

  if (!main || !branchVer) return null;

  const mainVersionId = main.current_version_id as string | null;
  const parentVersionId = branchVer.parent_version_id as string | null;

  if (!mainVersionId || !parentVersionId) return null;
  if (mainVersionId === parentVersionId || mainVersionId === branchVersionId) return null;

  const { data: baseVer } = await supabase
    .from("object_versions")
    .select("source_content")
    .eq("id", parentVersionId)
    .maybeSingle();

  return {
    objectType,
    objectId,
    mainVersionId,
    branchVersionId,
    branchParentVersionId: parentVersionId,
    mainContent: main.source_content as string | null,
    branchContent: branchVer.source_content as string | null,
    baseContent: (baseVer?.source_content as string | null) ?? null,
    displayName: (main.name as string) ?? `(deleted ${objectType})`,
  };
}
