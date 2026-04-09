"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  archiveFolder,
  unarchiveFolder,
  trashFolder,
  restoreFolder,
  archiveBox,
  unarchiveBox,
} from "@/server/services/lifecycle_service";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Folder lifecycle actions ─────────────────────────────────────────────────

/**
 * Archive a folder and all descendant folders and notes.
 * Blocked if the subtree contains the box's current guide note.
 */
export async function archiveFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const result = await archiveFolder(createAdminClient(), ctx.user!.id, ctx.workspace.id, folderId);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Unarchive a folder subtree. */
export async function unarchiveFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const result = await unarchiveFolder(createAdminClient(), ctx.user!.id, ctx.workspace.id, folderId);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/**
 * Trash a folder and all descendant folders and notes.
 * Blocked if the subtree contains the box's current guide note.
 */
export async function trashFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const result = await trashFolder(createAdminClient(), ctx.user!.id, ctx.workspace.id, folderId);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Restore a trashed folder subtree. */
export async function restoreFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const result = await restoreFolder(createAdminClient(), ctx.user!.id, ctx.workspace.id, folderId);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

// ─── Box lifecycle actions ────────────────────────────────────────────────────

/** Archive a box and all its non-trashed folders and notes. */
export async function archiveBoxAction(
  boxId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const result = await archiveBox(createAdminClient(), ctx.user!.id, ctx.workspace.id, boxId);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Unarchive a box and all its archived folders and notes. */
export async function unarchiveBoxAction(
  boxId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const result = await unarchiveBox(createAdminClient(), ctx.user!.id, ctx.workspace.id, boxId);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
