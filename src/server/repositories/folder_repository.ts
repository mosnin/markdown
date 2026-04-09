import { type SupabaseClient } from "@supabase/supabase-js";
import { type Folder } from "@/server/domain/types/folder";
import { FOLDER_STATUS } from "@/server/domain/constants/content_status";

export interface CreateFolderInput {
  box_id: string;
  parent_folder_id?: string | null;
  name: string;
  slug: string;
  path_cache: string;
  description?: string | null;
  accepts_generated_notes?: boolean;
}

export interface UpdateFolderInput {
  name?: string;
  path_cache?: string;
  description?: string | null;
  accepts_generated_notes?: boolean;
  status?: Folder["status"];
}

/**
 * Folder repository.
 *
 * path_cache must be maintained by the service layer when slugs or
 * parent_folder_id changes. This repository writes whatever path_cache
 * it receives — it does not compute or validate paths.
 */

export async function getFolderById(
  supabase: SupabaseClient,
  id: string
): Promise<Folder | null> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Folder;
}

export async function listFoldersByBox(
  supabase: SupabaseClient,
  box_id: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<Folder[]> {
  let query = supabase
    .from("folders")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", FOLDER_STATUS.TRASHED);

  if (!includeArchived) {
    query = query.neq("status", FOLDER_STATUS.ARCHIVED);
  }

  const { data, error } = await query.order("path_cache", { ascending: true });
  if (error || !data) return [];
  return data as Folder[];
}

export async function listFoldersByParent(
  supabase: SupabaseClient,
  parent_folder_id: string
): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("parent_folder_id", parent_folder_id)
    .neq("status", FOLDER_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Folder[];
}

/**
 * Fetch all non-trashed folders in a box in a single query.
 * Returns up to 1000 folders. Used for bulk export assembly.
 */
export async function listAllFoldersByBox(
  supabase: SupabaseClient,
  box_id: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<Folder[]> {
  let query = supabase
    .from("folders")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", FOLDER_STATUS.TRASHED);

  if (!includeArchived) {
    query = query.neq("status", FOLDER_STATUS.ARCHIVED);
  }

  const { data, error } = await query
    .order("path_cache", { ascending: true })
    .limit(1000);

  if (error || !data) return [];
  return data as Folder[];
}

/** Bulk-fetch folders by ids. */
export async function getFoldersByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Folder[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .in("id", ids);

  if (error || !data) return [];
  return data as Folder[];
}

export async function createFolder(
  supabase: SupabaseClient,
  input: CreateFolderInput
): Promise<Folder> {
  const { data, error } = await supabase
    .from("folders")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create folder");
  return data as Folder;
}

export async function updateFolder(
  supabase: SupabaseClient,
  id: string,
  input: UpdateFolderInput
): Promise<Folder | null> {
  const { data, error } = await supabase
    .from("folders")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Folder;
}
