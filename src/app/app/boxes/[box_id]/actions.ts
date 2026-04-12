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
import {
  withLifecycleChangeSet,
  lifecycleStatusFor,
} from "@/server/services/lifecycle_change_set";
import { type ChangeSetItemOperation } from "@/server/services/change_set_service";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Folder and box lifecycle actions.
 *
 * Every transition runs inside a `origin: 'lifecycle'` change set so
 * the operation is grouped, attributable, and reversible. The
 * lifecycle services keep running all their own guards (guide-note
 * protection, subtree cascade guards); the wrapper is pure
 * bookkeeping.
 *
 * Subtree operations (`archiveFolder`, `trashFolder`, etc.) cascade to
 * descendants inside a single SQL RPC — the change_set records the
 * root folder only, which is enough for the restore engine to undo
 * the whole subtree via the same RPC's inverse. Per-descendant
 * structural events are not written here because the subtree is
 * already described by the root folder's before/after status.
 */

async function runFolderLifecycle(
  folderId: string,
  op: Extract<
    ChangeSetItemOperation,
    "archive" | "unarchive" | "trash" | "restore_lifecycle"
  >,
  perform: (
    sb: ReturnType<typeof createAdminClient>,
    userId: string,
    workspaceId: string
  ) => Promise<{ folder_count: number; note_count: number }>,
  beforeStatus: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = createAdminClient();
    let result: { folder_count: number; note_count: number } = { folder_count: 0, note_count: 0 };
    await withLifecycleChangeSet(
      supabase,
      {
        workspaceId: ctx.workspace.id,
        userId: ctx.user!.id,
        objectType: "folder",
        objectId: folderId,
        operation: op,
        beforeStatus,
        afterStatus: lifecycleStatusFor(op),
        summary: `${op} folder ${folderId.slice(0, 8)}`,
      },
      async () => {
        result = await perform(supabase, ctx.user!.id, ctx.workspace.id);
      }
    );
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

async function runBoxLifecycle(
  boxId: string,
  op: "archive" | "unarchive",
  perform: (
    sb: ReturnType<typeof createAdminClient>,
    userId: string,
    workspaceId: string
  ) => Promise<{ folder_count: number; note_count: number }>,
  beforeStatus: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = createAdminClient();
    let result: { folder_count: number; note_count: number } = { folder_count: 0, note_count: 0 };
    await withLifecycleChangeSet(
      supabase,
      {
        workspaceId: ctx.workspace.id,
        userId: ctx.user!.id,
        objectType: "box",
        objectId: boxId,
        operation: op,
        beforeStatus,
        afterStatus: lifecycleStatusFor(op),
        summary: `${op} box ${boxId.slice(0, 8)}`,
      },
      async () => {
        result = await perform(supabase, ctx.user!.id, ctx.workspace.id);
      }
    );
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

// ─── Folder lifecycle actions ─────────────────────────────────────────────────

export async function archiveFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  return runFolderLifecycle(
    folderId,
    "archive",
    async (sb, u, w) => archiveFolder(sb, u, w, folderId),
    "active"
  );
}

export async function unarchiveFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  return runFolderLifecycle(
    folderId,
    "unarchive",
    async (sb, u, w) => unarchiveFolder(sb, u, w, folderId),
    "archived"
  );
}

export async function trashFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  return runFolderLifecycle(
    folderId,
    "trash",
    async (sb, u, w) => trashFolder(sb, u, w, folderId),
    "active"
  );
}

export async function restoreFolderAction(
  folderId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  return runFolderLifecycle(
    folderId,
    "restore_lifecycle",
    async (sb, u, w) => restoreFolder(sb, u, w, folderId),
    "trashed"
  );
}

// ─── Box lifecycle actions ────────────────────────────────────────────────────

export async function archiveBoxAction(
  boxId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  return runBoxLifecycle(
    boxId,
    "archive",
    async (sb, u, w) => archiveBox(sb, u, w, boxId),
    "active"
  );
}

export async function unarchiveBoxAction(
  boxId: string
): Promise<ActionResult<{ folder_count: number; note_count: number }>> {
  return runBoxLifecycle(
    boxId,
    "unarchive",
    async (sb, u, w) => unarchiveBox(sb, u, w, boxId),
    "archived"
  );
}
