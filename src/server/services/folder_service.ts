import { type SupabaseClient } from "@supabase/supabase-js";
import { type Folder } from "@/server/domain/types/folder";
import {
  getFolderById,
  listFoldersByBox,
  createFolder as repoCreate,
  updateFolder as repoUpdate,
} from "@/server/repositories/folder_repository";
import { FOLDER_STATUS } from "@/server/domain/constants/content_status";
import { slugify } from "@/lib/slugify";
import {
  auditFolderCreated,
  auditFolderRenamed,
} from "@/server/services/audit_service";

/**
 * Folder service.
 *
 * Handles path_cache computation and cascade updates when folders are renamed.
 * path_cache is always derived here — never caller-supplied.
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Check if path_cache is taken in a box (excluding trashed folders). */
async function pathCacheExists(
  supabase: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await supabase
    .from("folders")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", FOLDER_STATUS.TRASHED)
    .maybeSingle();
  return !!data;
}

/** Replace a path_cache prefix on all descendant folders and their notes. */
async function cascadePathCache(
  supabase: SupabaseClient,
  boxId: string,
  oldPrefix: string,
  newPrefix: string
): Promise<void> {
  const allFolders = await listFoldersByBox(supabase, boxId);

  for (const folder of allFolders) {
    if (folder.path_cache.startsWith(oldPrefix + "/")) {
      const newPath =
        newPrefix + folder.path_cache.slice(oldPrefix.length);
      await repoUpdate(supabase, folder.id, { path_cache: newPath });

      // Fetch notes in this descendant folder and update their path_cache
      const { data: notes } = await supabase
        .from("notes")
        .select("id, slug")
        .eq("folder_id", folder.id)
        .neq("status", "trashed");

      if (notes) {
        for (const note of notes) {
          await supabase
            .from("notes")
            .update({ path_cache: `${newPath}/${note.slug}` })
            .eq("id", note.id);
        }
      }
    }
  }

}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listFolders(
  supabase: SupabaseClient,
  boxId: string
): Promise<Folder[]> {
  return listFoldersByBox(supabase, boxId);
}

export async function createFolder(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  {
    boxId,
    name,
    description,
    parentFolderId,
  }: {
    boxId: string;
    name: string;
    description?: string | null;
    parentFolderId?: string | null;
  }
): Promise<Folder> {
  let parentPathCache = "";
  let effectiveBoxId = boxId;

  if (parentFolderId) {
    const parent = await getFolderById(supabase, parentFolderId);
    if (!parent) throw new Error("Parent folder not found");
    parentPathCache = parent.path_cache;
    effectiveBoxId = parent.box_id;
  }

  // Generate a unique slug / path_cache within the box
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  let pathCache = parentPathCache ? `${parentPathCache}/${slug}` : slug;

  while (await pathCacheExists(supabase, effectiveBoxId, pathCache)) {
    slug = `${base}-${suffix++}`;
    pathCache = parentPathCache ? `${parentPathCache}/${slug}` : slug;
  }

  const folder = await repoCreate(supabase, {
    box_id: effectiveBoxId,
    parent_folder_id: parentFolderId ?? null,
    name,
    slug,
    path_cache: pathCache,
    description: description ?? null,
    accepts_generated_notes: false,
  });

  await auditFolderCreated(
    supabase,
    workspaceId,
    userId,
    folder.id,
    folder.name,
    effectiveBoxId
  );
  return folder;
}

export async function renameFolder(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  folderId: string,
  newName: string
): Promise<Folder> {
  const folder = await getFolderById(supabase, folderId);
  if (!folder) throw new Error("Folder not found");

  const oldName = folder.name;
  const oldPathCache = folder.path_cache;

  // Compute new path_cache from new slug
  const newSlug = slugify(newName);
  const parentSegments = oldPathCache.split("/");
  parentSegments[parentSegments.length - 1] = newSlug;
  const newPathCache = parentSegments.join("/");

  const updated = await repoUpdate(supabase, folderId, {
    name: newName,
    path_cache: newPathCache,
  });
  if (!updated) throw new Error("Failed to rename folder");

  // Update notes directly inside this folder
  const { data: directNotes } = await supabase
    .from("notes")
    .select("id, slug")
    .eq("folder_id", folderId)
    .neq("status", "trashed");

  if (directNotes) {
    for (const note of directNotes) {
      await supabase
        .from("notes")
        .update({ path_cache: `${newPathCache}/${note.slug}` })
        .eq("id", note.id);
    }
  }

  // Cascade to descendant folders and their notes
  if (oldPathCache !== newPathCache) {
    await cascadePathCache(supabase, folder.box_id, oldPathCache, newPathCache);
  }

  await auditFolderRenamed(
    supabase,
    workspaceId,
    userId,
    folderId,
    oldName,
    newName
  );
  return updated;
}
