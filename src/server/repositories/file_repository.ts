/**
 * File repository.
 *
 * Design notes:
 * - path_cache is written by the caller; this repository does not compute it.
 * - content_bytes should be set to the byte length of source_content before
 *   calling createFile or updateFile (service responsibility).
 * - current_version_id is updated via updateFile after a version is created.
 * - Files share version history with skills/agents via object_versions, not note_versions.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type File } from "@/server/domain/types/file";
import {
  type CreateFileInput,
  type UpdateFileInput,
} from "@/server/domain/schemas/file_schemas";
import { OBJECT_STATUS } from "@/server/domain/constants/object_constants";

/**
 * Fetch a single file by its primary key.
 * Returns null if not found or on error.
 */
export async function getFileById(
  supabase: SupabaseClient,
  id: string
): Promise<File | null> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as File;
}

/**
 * Fetch a file by its path within a box.
 * Excludes trashed files — callers that need trashed files should use getFileById directly.
 */
export async function getFileByPath(
  supabase: SupabaseClient,
  box_id: string,
  path_cache: string
): Promise<File | null> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("box_id", box_id)
    .eq("path_cache", path_cache)
    .neq("status", OBJECT_STATUS.TRASHED)
    .single();

  if (error || !data) return null;
  return data as File;
}

/**
 * List files in a box with optional folder scoping and pagination.
 * Excludes trashed files. Pass includeArchived = true to include archived files.
 * Pass folder_id = null to scope to the box root; omit it to return all folders.
 */
export async function listFilesByBox(
  supabase: SupabaseClient,
  box_id: string,
  {
    folder_id,
    includeArchived = false,
    limit = 100,
    offset = 0,
    branchId = null,
  }: {
    folder_id?: string | null;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
    /**
     * Branch context for the read:
     *   - null  → main-only view (files with branch_id IS NULL).
     *   - uuid  → main + rows whose branch_id matches. Use the active
     *             branch from RequestContext so package pages + box
     *             trees surface draft-created files to the author
     *             without leaking to other users.
     */
    branchId?: string | null;
  } = {}
): Promise<File[]> {
  let query = supabase
    .from("files")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", OBJECT_STATUS.TRASHED);

  // Branch filter: either show only main rows (branch_id is null) or
  // show main + rows belonging to the specified branch.
  if (branchId) {
    query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  } else {
    query = query.is("branch_id", null);
  }

  if (!includeArchived) {
    query = query.neq("status", OBJECT_STATUS.ARCHIVED);
  }

  // null means root level; undefined means all folders
  if (folder_id !== undefined) {
    if (folder_id === null) {
      query = query.is("folder_id", null);
    } else {
      query = query.eq("folder_id", folder_id);
    }
  }

  const { data, error } = await query
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];

  // Pending-op overlay: hide files with a `trash` pending op on the
  // active branch. See pending_op_service.getHiddenByPendingOps.
  if (branchId && (data as File[]).length > 0) {
    const { getHiddenByPendingOps } = await import(
      "@/server/services/pending_op_service"
    );
    const hidden = await getHiddenByPendingOps(supabase, branchId);
    return (data as File[]).filter((f) => !hidden.has(`file:${f.id}`));
  }

  return data as File[];
}

/**
 * Fetch all non-trashed files in a box in a single query (up to 1000).
 * Used for bulk export assembly and box-level context preparation.
 */
export async function listAllFilesByBox(
  supabase: SupabaseClient,
  box_id: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<File[]> {
  let query = supabase
    .from("files")
    .select("*")
    .eq("box_id", box_id)
    .neq("status", OBJECT_STATUS.TRASHED);

  if (!includeArchived) {
    query = query.neq("status", OBJECT_STATUS.ARCHIVED);
  }

  const { data, error } = await query
    .order("path_cache", { ascending: true })
    .limit(1000);

  if (error || !data) return [];
  return data as File[];
}

/**
 * Insert a new file row.
 * The caller must supply content_bytes (byte length of source_content).
 * Throws on database error.
 */
export async function createFile(
  supabase: SupabaseClient,
  input: CreateFileInput & { content_bytes: number }
): Promise<File> {
  const { data, error } = await supabase
    .from("files")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create file");
  return data as File;
}

/**
 * Update a file row by id.
 * The caller may supply content_bytes if source_content is being updated.
 * Returns null if the row is not found or an error occurs.
 */
export async function updateFile(
  supabase: SupabaseClient,
  id: string,
  input: UpdateFileInput & { content_bytes?: number; path_cache?: string }
): Promise<File | null> {
  const { data, error } = await supabase
    .from("files")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as File;
}

/**
 * List trashed files for a box (for the trash recovery surface).
 * Results are ordered by most-recently-trashed first.
 */
export async function listTrashedFilesByBox(
  supabase: SupabaseClient,
  box_id: string
): Promise<File[]> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("box_id", box_id)
    .eq("status", OBJECT_STATUS.TRASHED)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];
  return data as File[];
}

/**
 * Bulk-fetch files by id.
 * Returns an empty array when ids is empty.
 * Used for bundle assembly and export preparation.
 */
export async function getFilesByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<File[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("files")
    .select("*")
    .in("id", ids);

  if (error || !data) return [];
  return data as File[];
}
