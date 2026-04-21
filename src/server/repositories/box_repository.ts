import { type SupabaseClient } from "@supabase/supabase-js";
import { type Box } from "@/server/domain/types/box";
import {
  type CreateBoxInput,
  type UpdateBoxInput,
} from "@/server/domain/schemas/box_schemas";
import { BOX_STATUS } from "@/server/domain/constants/content_status";

/**
 * Box repository.
 *
 * Note on guide_note_id:
 *   Clearing or changing guide_note_id must go through updateBox().
 *   The service layer is responsible for ensuring a guide note is not
 *   trashed while still set as boxes.guide_note_id.
 */

export async function getBoxById(
  supabase: SupabaseClient,
  id: string
): Promise<Box | null> {
  const { data, error } = await supabase
    .from("boxes")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Box;
}

export async function getBoxBySlug(
  supabase: SupabaseClient,
  workspace_id: string,
  slug: string
): Promise<Box | null> {
  const { data, error } = await supabase
    .from("boxes")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("slug", slug)
    .neq("status", BOX_STATUS.TRASHED)
    .single();

  if (error || !data) return null;
  return data as Box;
}

export async function listBoxesByWorkspace(
  supabase: SupabaseClient,
  workspace_id: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<Box[]> {
  let query = supabase
    .from("boxes")
    .select("*")
    .eq("workspace_id", workspace_id)
    .neq("status", BOX_STATUS.TRASHED);

  if (!includeArchived) {
    query = query.neq("status", BOX_STATUS.ARCHIVED);
  }

  const { data, error } = await query.order("name", { ascending: true });
  if (error || !data) return [];
  return data as Box[];
}

export async function createBox(
  supabase: SupabaseClient,
  input: CreateBoxInput
): Promise<Box> {
  const { data, error } = await supabase
    .from("boxes")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create box");
  return data as Box;
}

export async function updateBox(
  supabase: SupabaseClient,
  id: string,
  input: UpdateBoxInput
): Promise<Box | null> {
  const { data, error } = await supabase
    .from("boxes")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Box;
}

export async function listPublicBoxesByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Box[]> {
  const { data, error } = await supabase
    .from("boxes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_public", true)
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Box[];
}

export async function getWorkspaceBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<{ id: string; name: string; slug: string } | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return data as { id: string; name: string; slug: string };
}
