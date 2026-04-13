/**
 * Box object attachment repository.
 *
 * Design notes:
 * - BoxObjectAttachments model the attachment of workspace-level reusable skills
 *   and agents into a specific box. The reusable object is NOT copied — it is
 *   referenced by pointer and auto-reflects upstream updates.
 * - Only object_type values 'skill' and 'agent' are valid attachment targets.
 * - Detaching an attachment never affects the reusable source object or its
 *   attachments in other boxes.
 * - No UPDATE: attachment position changes are handled via delete + re-insert.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type BoxObjectAttachment } from "@/server/domain/types/box_object_attachment";

/** Input shape for creating a new box object attachment. */
export interface CreateBoxObjectAttachmentInput {
  workspace_id: string;
  box_id: string;
  folder_id?: string | null;
  object_type: "skill" | "agent";
  object_id: string;
  sort_order?: number;
  attached_by?: string | null;
}

/**
 * List all attachments for a given box, ordered by sort_order ascending.
 * Includes all attached skills and agents regardless of folder placement.
 *
 * Branch-aware: when `branchId` is supplied, every attachment row is
 * overlaid with its per-branch placement override (sort_order,
 * folder_id) before being returned. Main readers (no branchId) never
 * touch the overrides table.
 */
export async function listAttachmentsForBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    branchId = null,
  }: { branchId?: string | null } = {}
): Promise<BoxObjectAttachment[]> {
  const { data, error } = await supabase
    .from("box_object_attachments")
    .select("*")
    .eq("box_id", box_id)
    .order("sort_order", { ascending: true });

  if (error || !data) return [];
  let rows = data as BoxObjectAttachment[];

  if (branchId) {
    const {
      applyPlacementOverridesToList,
      listPlacementOverridesForBox,
    } = await import("@/server/services/placement_branch_service");
    const overrides = await listPlacementOverridesForBox(
      supabase,
      branchId,
      box_id
    );
    const map = new Map<string, (typeof overrides)[number]>();
    for (const ov of overrides) {
      if (ov.target_type !== "box_object_attachment") continue;
      map.set(ov.target_id, ov);
    }
    rows = applyPlacementOverridesToList(rows, (r) => r.id, map);
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  return rows;
}

/**
 * List all boxes a given reusable object is attached to.
 * Results are ordered by attachment time ascending.
 */
export async function listAttachmentsForObject(
  supabase: SupabaseClient,
  workspace_id: string,
  object_type: "skill" | "agent",
  object_id: string
): Promise<BoxObjectAttachment[]> {
  const { data, error } = await supabase
    .from("box_object_attachments")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .order("attached_at", { ascending: true });

  if (error || !data) return [];
  return data as BoxObjectAttachment[];
}

/**
 * Insert a new box object attachment.
 * Throws on database error (e.g. duplicate attachment — unique constraint violation).
 */
export async function createAttachment(
  supabase: SupabaseClient,
  input: CreateBoxObjectAttachmentInput
): Promise<BoxObjectAttachment> {
  const { data, error } = await supabase
    .from("box_object_attachments")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create box object attachment");
  return data as BoxObjectAttachment;
}

/**
 * Hard-delete a single attachment by its primary key.
 * Returns true if deleted, false if not found or an error occurred.
 */
export async function deleteAttachment(
  supabase: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await supabase
    .from("box_object_attachments")
    .delete()
    .eq("id", id);

  return !error;
}

/**
 * Hard-delete the attachment for a specific object in a specific box.
 * Used to detach a reusable skill or agent from a box without knowing the attachment id.
 * No-ops silently if the attachment does not exist.
 */
export async function deleteAttachmentForObject(
  supabase: SupabaseClient,
  box_id: string,
  object_type: "skill" | "agent",
  object_id: string
): Promise<void> {
  await supabase
    .from("box_object_attachments")
    .delete()
    .eq("box_id", box_id)
    .eq("object_type", object_type)
    .eq("object_id", object_id);
}

/**
 * Check whether a given object is already attached to a given box.
 * Returns true if an attachment row exists, false otherwise.
 */
export async function isObjectAttachedToBox(
  supabase: SupabaseClient,
  box_id: string,
  object_type: "skill" | "agent",
  object_id: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("box_object_attachments")
    .select("id")
    .eq("box_id", box_id)
    .eq("object_type", object_type)
    .eq("object_id", object_id)
    .single();

  if (error || !data) return false;
  return true;
}
