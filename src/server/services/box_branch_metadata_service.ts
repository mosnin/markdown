import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Box metadata overlay for branch-aware writes.
 *
 * Closes the leak in `updateBoxAction` where editing a box's name
 * or description on a draft branch wrote straight to the canonical
 * `boxes` row. Overlay rows carry the per-(branch, box) override;
 * branch reads patch the canonical box with the overlay's non-null
 * fields; promote applies the overlay to main and records a
 * change_set_item; discard hard-deletes the overlay.
 *
 * Shape intentionally mirrors `package_branch_service` — same upsert
 * semantics, same null-means-no-override contract, same apply-on-read
 * helper. Kept in a separate table rather than piggybacking on
 * `branch_package_metadata` because:
 *
 *   * `branch_package_metadata.package_type` has a hard CHECK on
 *     `('skill','agent')`. Adding 'box' would touch RLS, promote,
 *     diff, and the agent-only columns (`agent_type`, `model_hint`,
 *     `system_prompt`) become dead weight for every box row.
 *   * Boxes have a narrower field set (name + description). A
 *     dedicated table keeps the schema honest.
 *
 * See `docs/branch_local_structural_creation_v1.md` §v1.9.
 */

export interface BoxMetadataOverlay {
  id: string;
  branch_id: string;
  box_id: string;
  name: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertBoxOverlayInput {
  branchId: string;
  boxId: string;
  /** undefined = leave alone; null = explicit clear. */
  name?: string | null;
  description?: string | null;
}

/**
 * Upsert overlay row for (branch, box). The UNIQUE constraint lets
 * successive edits collapse onto the same row.
 */
export async function upsertBoxMetadataOverlay(
  supabase: SupabaseClient,
  input: UpsertBoxOverlayInput
): Promise<BoxMetadataOverlay> {
  const patch: Record<string, unknown> = {
    branch_id: input.branchId,
    box_id: input.boxId,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;

  const { data, error } = await supabase
    .from("box_branch_metadata_overlay")
    .upsert(patch, { onConflict: "branch_id,box_id" })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to upsert box metadata overlay");
  // Branch-activity touch (Feature #8). Swallow errors so a lifecycle
  // failure never blocks the overlay write.
  try {
    const { touchBranchActivity } = await import("./branch_lifecycle_service");
    await touchBranchActivity(supabase, input.branchId, "");
  } catch {
    // swallowed on purpose
  }
  return data as BoxMetadataOverlay;
}

export async function getBoxMetadataOverlay(
  supabase: SupabaseClient,
  branchId: string,
  boxId: string
): Promise<BoxMetadataOverlay | null> {
  const { data } = await supabase
    .from("box_branch_metadata_overlay")
    .select("*")
    .eq("branch_id", branchId)
    .eq("box_id", boxId)
    .maybeSingle();
  return (data as BoxMetadataOverlay | null) ?? null;
}

export async function listBoxMetadataOverlaysForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<BoxMetadataOverlay[]> {
  const { data } = await supabase
    .from("box_branch_metadata_overlay")
    .select("*")
    .eq("branch_id", branchId);
  return (data ?? []) as BoxMetadataOverlay[];
}

/** Hard-drop every overlay row for the branch — used by discard. */
export async function dropAllBoxOverlaysForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<void> {
  await supabase
    .from("box_branch_metadata_overlay")
    .delete()
    .eq("branch_id", branchId);
}

/**
 * Apply overlay fields onto a loaded box row. Mirrors
 * `applyPackageMetadataOverlay`. No-op when overlay is null.
 */
export function applyBoxMetadataOverlay<T extends Record<string, unknown>>(
  row: T,
  overlay: BoxMetadataOverlay | null
): T {
  if (!overlay) return row;
  const out = { ...row };
  for (const f of ["name", "description"] as const) {
    const v = overlay[f];
    // Null = "no override" (the overlay row stores null for columns
    // the user hasn't set); only non-null values patch the returned
    // row. Matches the semantic in `applyPackageMetadataOverlay`.
    if (v !== null && v !== undefined) {
      (out as Record<string, unknown>)[f] = v;
    }
  }
  return out;
}

/**
 * Compute the before/after pair for an overlay vs. main, filtering
 * to fields that actually differ. Used by branch_diff_service.
 */
export async function deriveBoxMetadataChanges(
  supabase: SupabaseClient,
  overlay: BoxMetadataOverlay
): Promise<Array<{ field: "name" | "description"; mainValue: unknown; branchValue: unknown }>> {
  const { data: main } = await supabase
    .from("boxes")
    .select("id, name, description")
    .eq("id", overlay.box_id)
    .maybeSingle();
  const out: Array<{ field: "name" | "description"; mainValue: unknown; branchValue: unknown }> = [];
  for (const f of ["name", "description"] as const) {
    const branchVal = overlay[f];
    if (branchVal === undefined) continue;
    const mainVal = (main as Record<string, unknown> | null)?.[f] ?? null;
    if (mainVal === branchVal) continue;
    out.push({ field: f, mainValue: mainVal, branchValue: branchVal });
  }
  return out;
}

/**
 * Promote every overlay for the branch onto main. Returns one
 * entry per applied overlay for the caller (branch_service) to
 * record change_set_items.
 *
 * When `filter` is provided, overlays whose box_id fails the
 * predicate are skipped — used by partial-promote (cherry-pick) to
 * leave unselected overlays on the branch for later.
 */
export async function promoteBoxOverlays(
  supabase: SupabaseClient,
  branchId: string,
  filter?: (boxId: string) => boolean
): Promise<Array<{
  boxId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}>> {
  const overlays = await listBoxMetadataOverlaysForBranch(supabase, branchId);
  const results: Array<{
    boxId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [];
  for (const ov of overlays) {
    if (filter && !filter(ov.box_id)) continue;
    const patch: Record<string, unknown> = {};
    if (ov.name !== null && ov.name !== undefined) patch.name = ov.name;
    if (ov.description !== null && ov.description !== undefined) patch.description = ov.description;
    if (Object.keys(patch).length === 0) continue;

    const { data: before } = await supabase
      .from("boxes")
      .select("id, name, description")
      .eq("id", ov.box_id)
      .maybeSingle();

    await supabase.from("boxes").update(patch).eq("id", ov.box_id);

    // Keep denormalized workspace_objects.display_name in sync when
    // promoting a rename so box listings reflect the new name.
    if (typeof patch.name === "string") {
      await supabase
        .from("workspace_objects")
        .update({ display_name: patch.name })
        .eq("object_type", "box")
        .eq("object_id", ov.box_id);
    }

    results.push({
      boxId: ov.box_id,
      before: (before ?? {}) as Record<string, unknown>,
      after: { ...patch, promoted_from_branch: branchId },
    });
  }
  return results;
}
