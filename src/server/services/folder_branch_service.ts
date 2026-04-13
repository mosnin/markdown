import { type SupabaseClient } from "@supabase/supabase-js";
import { type Folder } from "@/server/domain/types/folder";

/**
 * Folder-branch overlay service.
 *
 * Folders already carry a `branch_id` column so branch-local folder
 * *creation* works. What was missing: *edits* to existing main
 * folders (rename / reparent / reorder) still mutated the canonical
 * row directly, which violates the "branches must not silently
 * mutate main" trust rule.
 *
 * This module mirrors `branch_package_metadata_service` for folders:
 * a per-(branch, folder) overlay row whose non-null fields are
 * applied on top of the canonical folder at read time and written
 * through to the canonical row on promote.
 *
 *   1. `upsertFolderOverride` — upserts on (branch_id, folder_id),
 *      merges with the previous override row so successive edits
 *      on a branch accumulate into one overlay.
 *   2. `applyOverrideToFolder` — pure overlay merge used by readers.
 *      NULL fields on the override side mean "no override, inherit
 *      from main".
 *   3. `promoteFolderOverrides` — on promote, copies every overlay
 *      row's non-null fields onto the canonical `folders` row. Left
 *      in place as audit trail afterwards.
 *   4. `dropFolderOverride` / `dropAllFolderOverridesForBranch` —
 *      rollback / discard surface.
 *
 * Notes:
 *
 * - `parent_folder_id` is intentionally nullable on the overlay row
 *   WITH no FK. NULL on the column means "no override"; reparenting
 *   to root is expressed via `rootParent` being present in the patch
 *   — callers use `null` explicitly in that case but the service
 *   pushes them through the same nullable column. In practice
 *   writing `null` for "move to root" collides with "no override",
 *   so the `upsertFolderOverride` surface requires reparent callers
 *   to pass `parent_folder_id: null` explicitly, and treats
 *   `undefined` as "don't touch this field on the overlay". See the
 *   write-path wiring for how the distinction is preserved at the
 *   action layer.
 */

export interface FolderBranchOverride {
  id: string;
  branch_id: string;
  folder_id: string;
  name: string | null;
  parent_folder_id: string | null;
  sort_order: number | null;
  path_cache: string | null;
  actor_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Patch accepted by {@link upsertFolderOverride}. A field set to
 * `undefined` (or absent) is left alone on the existing override
 * row. Explicit `null` writes `null` to the override, which means
 * "no override for this field" at read time. `parent_folder_id` is
 * special-cased: callers that want to reparent to root must pass
 * `rootParent: true` alongside; see wiring code.
 */
export interface FolderOverridePatch {
  name?: string | null;
  parent_folder_id?: string | null;
  sort_order?: number | null;
  path_cache?: string | null;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function upsertFolderOverride(
  supabase: SupabaseClient,
  input: {
    branchId: string;
    folderId: string;
    actorId: string;
    patch: FolderOverridePatch;
  }
): Promise<FolderBranchOverride> {
  const row: Record<string, unknown> = {
    branch_id: input.branchId,
    folder_id: input.folderId,
    actor_id: input.actorId,
  };
  if (input.patch.name !== undefined) row.name = input.patch.name;
  if (input.patch.parent_folder_id !== undefined) row.parent_folder_id = input.patch.parent_folder_id;
  if (input.patch.sort_order !== undefined) row.sort_order = input.patch.sort_order;
  if (input.patch.path_cache !== undefined) row.path_cache = input.patch.path_cache;

  const { data, error } = await supabase
    .from("folder_branch_overrides")
    .upsert(row, { onConflict: "branch_id,folder_id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to upsert folder override");
  }
  return data as FolderBranchOverride;
}

export async function getFolderOverride(
  supabase: SupabaseClient,
  branchId: string,
  folderId: string
): Promise<FolderBranchOverride | null> {
  const { data } = await supabase
    .from("folder_branch_overrides")
    .select("*")
    .eq("branch_id", branchId)
    .eq("folder_id", folderId)
    .maybeSingle();
  return (data as FolderBranchOverride | null) ?? null;
}

export async function listFolderOverridesForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<FolderBranchOverride[]> {
  const { data } = await supabase
    .from("folder_branch_overrides")
    .select("*")
    .eq("branch_id", branchId);
  return (data ?? []) as FolderBranchOverride[];
}

export async function dropFolderOverride(
  supabase: SupabaseClient,
  branchId: string,
  folderId: string
): Promise<void> {
  const { error } = await supabase
    .from("folder_branch_overrides")
    .delete()
    .eq("branch_id", branchId)
    .eq("folder_id", folderId);
  if (error) throw new Error(error.message);
}

export async function dropAllFolderOverridesForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<void> {
  const { error } = await supabase
    .from("folder_branch_overrides")
    .delete()
    .eq("branch_id", branchId);
  if (error) throw new Error(error.message);
}

// ─── Pure overlay ────────────────────────────────────────────────────────────

/**
 * Overlay a single folder row with its branch override. Pure; no
 * I/O. NULL override fields mean "inherit from main" and are
 * skipped. Non-null fields win.
 *
 * Returns a new object — the input folder is not mutated.
 */
export function applyOverrideToFolder(
  folder: Folder,
  override: FolderBranchOverride | null | undefined
): Folder {
  if (!override) return folder;
  const out: Folder = { ...folder };
  if (override.name !== null && override.name !== undefined) out.name = override.name;
  if (override.parent_folder_id !== null && override.parent_folder_id !== undefined) {
    out.parent_folder_id = override.parent_folder_id;
  }
  if (override.path_cache !== null && override.path_cache !== undefined) {
    out.path_cache = override.path_cache;
  }
  // `sort_order` isn't a Folder field today — it lives in
  // workspace_objects. Overlay stores intent, promote applies to the
  // correct table. No-op on the pure merge.
  return out;
}

/**
 * Batch-apply overrides keyed by folder_id. Callers typically build
 * the map once per render via {@link listFolderOverridesForBranch}.
 */
export function applyFolderOverridesToList(
  folders: Folder[],
  overridesById: Map<string, FolderBranchOverride>
): Folder[] {
  if (overridesById.size === 0) return folders;
  return folders.map((f) => applyOverrideToFolder(f, overridesById.get(f.id)));
}

// ─── Promote ─────────────────────────────────────────────────────────────────

export interface PromotedFolderOverride {
  folderId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Apply every overlay row for the branch to its canonical folder.
 * Returns `{ folderId, before, after }` per applied overlay so the
 * caller can record change_set_items. Overlays with nothing to write
 * (all override columns NULL) are reported with empty before/after.
 */
export async function promoteFolderOverrides(
  supabase: SupabaseClient,
  branchId: string
): Promise<PromotedFolderOverride[]> {
  const overrides = await listFolderOverridesForBranch(supabase, branchId);
  const out: PromotedFolderOverride[] = [];

  for (const ov of overrides) {
    const patch: Record<string, unknown> = {};
    if (ov.name !== null) patch.name = ov.name;
    if (ov.parent_folder_id !== null) patch.parent_folder_id = ov.parent_folder_id;
    if (ov.path_cache !== null) patch.path_cache = ov.path_cache;

    if (Object.keys(patch).length === 0) {
      // sort_order-only override — apply via workspace_objects since
      // folders don't carry sort_order themselves.
      if (ov.sort_order !== null) {
        const { data: before } = await supabase
          .from("workspace_objects")
          .select("sort_order")
          .eq("object_type", "folder")
          .eq("object_id", ov.folder_id)
          .maybeSingle();
        await supabase
          .from("workspace_objects")
          .update({ sort_order: ov.sort_order })
          .eq("object_type", "folder")
          .eq("object_id", ov.folder_id);
        out.push({
          folderId: ov.folder_id,
          before: { sort_order: (before as { sort_order?: unknown } | null)?.sort_order ?? null },
          after: { sort_order: ov.sort_order },
        });
      } else {
        out.push({ folderId: ov.folder_id, before: {}, after: {} });
      }
      continue;
    }

    const selectCols = Object.keys(patch).join(", ");
    const { data: before } = await supabase
      .from("folders")
      .select(selectCols)
      .eq("id", ov.folder_id)
      .maybeSingle();

    await supabase
      .from("folders")
      .update(patch)
      .eq("id", ov.folder_id);

    // Apply sort_order to workspace_objects if present alongside the
    // folder-column override.
    if (ov.sort_order !== null) {
      await supabase
        .from("workspace_objects")
        .update({ sort_order: ov.sort_order })
        .eq("object_type", "folder")
        .eq("object_id", ov.folder_id);
    }

    const afterSnap: Record<string, unknown> = { ...patch };
    if (ov.sort_order !== null) afterSnap.sort_order = ov.sort_order;

    out.push({
      folderId: ov.folder_id,
      before: (before ?? {}) as Record<string, unknown>,
      after: afterSnap,
    });
  }
  return out;
}
