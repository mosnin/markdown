import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Branch-local placement overlay service.
 *
 * Captures sort_order + folder placement intent for any draggable
 * tree entry (native workspace_objects rows or box_object_attachments
 * rows) while a branch is active, so reorder/move never mutates the
 * canonical row. Reads overlay; promote writes back; discard drops.
 *
 * Closes the last main-mutating leak for reorder and cross-folder
 * moves. See docs/branch_local_sort_order_and_reorder_isolation_v1.md.
 *
 *   1. `upsertPlacementOverride` — upserts on (branch_id, target_type,
 *      target_id), merges the declared patch keys so successive
 *      drags accumulate into one overlay row.
 *   2. `applyPlacementOverrideToRow` / `applyPlacementOverridesToList`
 *      — pure. Overlay only the fields that are "present": sort_order
 *      when non-null, folder_id when folder_id_overridden=true. Input
 *      rows are not mutated.
 *   3. `promotePlacementOverrides` — copies overlay sort_order +
 *      folder_id back onto the canonical row on promote. Returns
 *      before/after snapshots for the change-set recorder.
 *   4. `dropPlacementOverride`, `dropPlacementOverridesForTarget`,
 *      `dropAllPlacementOverridesForBranch` — rollback + discard.
 */

export type PlacementTargetType =
  | "workspace_object"
  | "box_object_attachment";

export interface PlacementOverride {
  id: string;
  branch_id: string;
  target_type: PlacementTargetType;
  target_id: string;
  object_type: string | null;
  object_id: string | null;
  box_id: string;
  sort_order: number | null;
  folder_id: string | null;
  folder_id_overridden: boolean;
  actor_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlacementOverridePatch {
  /** Set to a number to record a sort_order override; undefined skips. */
  sortOrder?: number | null;
  /**
   * Explicit folder pointer. Paired with `folderIdOverridden`; set
   * both (the flag distinguishes "override to null / root" from
   * "no override").
   */
  folderId?: string | null;
  folderIdOverridden?: boolean;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function upsertPlacementOverride(
  supabase: SupabaseClient,
  input: {
    branchId: string;
    actorId: string;
    targetType: PlacementTargetType;
    targetId: string;
    objectType?: string | null;
    objectId?: string | null;
    boxId: string;
    patch: PlacementOverridePatch;
  }
): Promise<PlacementOverride> {
  const row: Record<string, unknown> = {
    branch_id: input.branchId,
    target_type: input.targetType,
    target_id: input.targetId,
    box_id: input.boxId,
    actor_id: input.actorId,
    updated_at: new Date().toISOString(),
  };
  if (input.objectType !== undefined) row.object_type = input.objectType;
  if (input.objectId !== undefined) row.object_id = input.objectId;
  if (input.patch.sortOrder !== undefined) row.sort_order = input.patch.sortOrder;
  if (input.patch.folderId !== undefined) row.folder_id = input.patch.folderId;
  if (input.patch.folderIdOverridden !== undefined) {
    row.folder_id_overridden = input.patch.folderIdOverridden;
  }

  const { data, error } = await supabase
    .from("branch_placement_overrides")
    .upsert(row, { onConflict: "branch_id,target_type,target_id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to upsert placement override");
  }
  return data as PlacementOverride;
}

export async function getPlacementOverride(
  supabase: SupabaseClient,
  branchId: string,
  targetType: PlacementTargetType,
  targetId: string
): Promise<PlacementOverride | null> {
  const { data } = await supabase
    .from("branch_placement_overrides")
    .select("*")
    .eq("branch_id", branchId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();
  return (data as PlacementOverride | null) ?? null;
}

export async function listPlacementOverridesForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<PlacementOverride[]> {
  const { data } = await supabase
    .from("branch_placement_overrides")
    .select("*")
    .eq("branch_id", branchId);
  return (data ?? []) as PlacementOverride[];
}

export async function listPlacementOverridesForBox(
  supabase: SupabaseClient,
  branchId: string,
  boxId: string
): Promise<PlacementOverride[]> {
  const { data } = await supabase
    .from("branch_placement_overrides")
    .select("*")
    .eq("branch_id", branchId)
    .eq("box_id", boxId);
  return (data ?? []) as PlacementOverride[];
}

export async function dropPlacementOverride(
  supabase: SupabaseClient,
  input: {
    branchId: string;
    targetType: PlacementTargetType;
    targetId: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("branch_placement_overrides")
    .delete()
    .eq("branch_id", input.branchId)
    .eq("target_type", input.targetType)
    .eq("target_id", input.targetId);
  if (error) throw new Error(error.message);
}

export async function dropPlacementOverridesForTarget(
  supabase: SupabaseClient,
  targetType: PlacementTargetType,
  targetId: string
): Promise<void> {
  const { error } = await supabase
    .from("branch_placement_overrides")
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId);
  if (error) throw new Error(error.message);
}

export async function dropAllPlacementOverridesForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<void> {
  const { error } = await supabase
    .from("branch_placement_overrides")
    .delete()
    .eq("branch_id", branchId);
  if (error) throw new Error(error.message);
}

// ─── Pure overlay ────────────────────────────────────────────────────────────

/**
 * Minimal shape the pure overlay touches. Real callers pass
 * workspace_objects / box_object_attachments rows that carry many
 * more columns — we preserve every field through the spread and
 * only narrow the two fields we overlay. Kept as a plain object
 * type (no index signature) so concrete repository row types can
 * extend it without an `as unknown as ...` dance.
 */
export interface PlaceableRow {
  sort_order?: number | null;
  folder_id?: string | null;
}

/**
 * Overlay one placement row with its branch override. Pure; no I/O.
 *
 *  - `sort_order` is copied over only when the override column is
 *    non-null (null = "no sort override").
 *  - `folder_id` is copied over only when `folder_id_overridden` is
 *    true (supports "override to null / root").
 *
 * Returns a new object; the input row is not mutated.
 */
export function applyPlacementOverrideToRow<T extends PlaceableRow>(
  row: T,
  override: PlacementOverride | null | undefined
): T {
  if (!override) return row;
  const out = { ...row } as T & PlaceableRow;
  if (override.sort_order !== null && override.sort_order !== undefined) {
    out.sort_order = override.sort_order;
  }
  if (override.folder_id_overridden) {
    out.folder_id = override.folder_id;
  }
  return out;
}

/**
 * Batch-apply overrides keyed by the `(target_type, target_id)`
 * composite. Callers resolve the right key for each row themselves
 * (attachments index by attachment.id, workspace_objects by their
 * own id). Rows with no matching override pass through unchanged.
 */
export function applyPlacementOverridesToList<T extends PlaceableRow>(
  rows: T[],
  keyFor: (row: T) => string,
  overridesByKey: Map<string, PlacementOverride>
): T[] {
  if (overridesByKey.size === 0) return rows;
  return rows.map((r) => applyPlacementOverrideToRow(r, overridesByKey.get(keyFor(r))));
}

// ─── Promote ─────────────────────────────────────────────────────────────────

export interface PromotedPlacementOverride {
  targetType: PlacementTargetType;
  targetId: string;
  objectType: string | null;
  objectId: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Apply every placement overlay for the branch to its canonical row.
 * Workspace-object overlays write back to `workspace_objects`;
 * attachment overlays write to `box_object_attachments`. Rows with
 * nothing to apply (no sort override AND no folder override) are
 * reported with empty before/after so the caller can skip them.
 */
export async function promotePlacementOverrides(
  supabase: SupabaseClient,
  branchId: string
): Promise<PromotedPlacementOverride[]> {
  const overrides = await listPlacementOverridesForBranch(supabase, branchId);
  const out: PromotedPlacementOverride[] = [];

  for (const ov of overrides) {
    const patch: Record<string, unknown> = {};
    if (ov.sort_order !== null) patch.sort_order = ov.sort_order;
    if (ov.folder_id_overridden) patch.folder_id = ov.folder_id;

    if (Object.keys(patch).length === 0) {
      out.push({
        targetType: ov.target_type,
        targetId: ov.target_id,
        objectType: ov.object_type,
        objectId: ov.object_id,
        before: {},
        after: {},
      });
      continue;
    }

    if (ov.target_type === "workspace_object") {
      const selectCols = Object.keys(patch).join(", ");
      const { data: before } = await supabase
        .from("workspace_objects")
        .select(selectCols)
        .eq("id", ov.target_id)
        .maybeSingle();
      await supabase
        .from("workspace_objects")
        .update(patch)
        .eq("id", ov.target_id);

      // For native objects, folder_id changes also need to land on
      // the leaf table (notes/files/skills/agents) when the object
      // is one of those types. workspace_objects carries the index
      // entry; the leaf row carries its own folder_id. Keep them
      // in sync so readers that bypass workspace_objects see the
      // same state.
      if (ov.folder_id_overridden && ov.object_type && ov.object_id) {
        const leafTable =
          ov.object_type === "note" ? "notes" :
          ov.object_type === "file" ? "files" :
          ov.object_type === "skill" ? "skills" :
          ov.object_type === "agent" ? "agents" :
          ov.object_type === "folder" ? "folders" : null;
        if (leafTable === "folders") {
          await supabase
            .from("folders")
            .update({ parent_folder_id: ov.folder_id })
            .eq("id", ov.object_id);
        } else if (leafTable) {
          await supabase
            .from(leafTable)
            .update({ folder_id: ov.folder_id })
            .eq("id", ov.object_id);
        }
      }

      out.push({
        targetType: ov.target_type,
        targetId: ov.target_id,
        objectType: ov.object_type,
        objectId: ov.object_id,
        before: (before ?? {}) as Record<string, unknown>,
        after: { ...patch },
      });
    } else {
      // box_object_attachment
      const selectCols = Object.keys(patch).join(", ");
      const { data: before } = await supabase
        .from("box_object_attachments")
        .select(selectCols)
        .eq("id", ov.target_id)
        .maybeSingle();
      await supabase
        .from("box_object_attachments")
        .update(patch)
        .eq("id", ov.target_id);
      out.push({
        targetType: ov.target_type,
        targetId: ov.target_id,
        objectType: ov.object_type,
        objectId: ov.object_id,
        before: (before ?? {}) as Record<string, unknown>,
        after: { ...patch },
      });
    }
  }

  return out;
}
