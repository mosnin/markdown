import { type SupabaseClient } from "@supabase/supabase-js";
import { type Folder } from "@/server/domain/types/folder";
import { FOLDER_STATUS } from "@/server/domain/constants/content_status";
import {
  applyFolderOverridesToList,
  applyOverrideToFolder,
  type FolderBranchOverride,
} from "@/server/services/folder_branch_service";

export interface CreateFolderInput {
  workspace_id: string;
  box_id: string | null;
  parent_folder_id?: string | null;
  parent_skill_id?: string | null;
  parent_agent_id?: string | null;
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
  id: string,
  { branchId = null }: { branchId?: string | null } = {}
): Promise<Folder | null> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  const folder = data as Folder;
  if (branchId && folder.branch_id === null) {
    // Apply per-branch overlay. A main-routed folder edited on an
    // active branch is read through the override. Branch-local
    // folders (branch_id set) are returned as-is.
    const { data: ov } = await supabase
      .from("folder_branch_overrides")
      .select("*")
      .eq("branch_id", branchId)
      .eq("folder_id", id)
      .maybeSingle();
    return applyOverrideToFolder(folder, (ov as FolderBranchOverride | null) ?? null);
  }
  return folder;
}

export async function listFoldersByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    includeArchived = false,
    branchId = null,
  }: { includeArchived?: boolean; branchId?: string | null } = {}
): Promise<Folder[]> {
  let query = supabase
    .from("folders")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", FOLDER_STATUS.TRASHED);

  // Branch filter: null → main-only (branch_id IS NULL); uuid → main
  // + that branch's draft folders. Mirrors listFilesByBox.
  if (branchId) {
    query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  } else {
    query = query.is("branch_id", null);
  }

  if (!includeArchived) {
    query = query.neq("status", FOLDER_STATUS.ARCHIVED);
  }

  const { data, error } = await query.order("path_cache", { ascending: true });
  if (error || !data) return [];
  const folders = data as Folder[];

  if (!branchId) return folders;

  // Overlay every main-row folder with its per-branch override (if
  // any). Branch-local folders (branch_id set) bypass the overlay
  // since they have no main counterpart.
  const mainIds = folders.filter((f) => f.branch_id === null).map((f) => f.id);
  if (mainIds.length === 0) return folders;
  const { data: ovRows } = await supabase
    .from("folder_branch_overrides")
    .select("*")
    .eq("branch_id", branchId)
    .in("folder_id", mainIds);
  const overridesById = new Map<string, FolderBranchOverride>();
  for (const r of (ovRows ?? []) as FolderBranchOverride[]) {
    overridesById.set(r.folder_id, r);
  }
  return applyFolderOverridesToList(folders, overridesById);
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

/** List trashed folders for a box (for the trash recovery surface). */
export async function listTrashedFoldersByBox(
  supabase: SupabaseClient,
  box_id: string
): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("box_id", box_id)
    .eq("status", FOLDER_STATUS.TRASHED)
    .order("path_cache", { ascending: true });

  if (error || !data) return [];
  return data as Folder[];
}

/** List archived folders for a box (for the archive browsing surface). */
export async function listArchivedFoldersByBox(
  supabase: SupabaseClient,
  box_id: string
): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("box_id", box_id)
    .eq("status", FOLDER_STATUS.ARCHIVED)
    .order("path_cache", { ascending: true });

  if (error || !data) return [];
  return data as Folder[];
}
