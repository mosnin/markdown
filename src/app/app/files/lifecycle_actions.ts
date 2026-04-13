"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import {
  archiveFile,
  unarchiveFile,
  trashFile,
  restoreFile,
} from "@/server/services/lifecycle_service";
import {
  rollbackObjectToVersion,
} from "@/server/services/version_history_service";
import {
  withLifecycleChangeSet,
  lifecycleStatusFor,
} from "@/server/services/lifecycle_change_set";
import { type ChangeSetItemOperation } from "@/server/services/change_set_service";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Guard: reject blank / non-string IDs before hitting the service layer.
function assertNonEmptyId(id: string, label: string): { ok: false; error: string } | null {
  if (!id || id.trim() === "") return { ok: false, error: `${label} is required` };
  return null;
}

// ─── File lifecycle ───────────────────────────────────────────────────────────

async function runFileLifecycle(
  fileId: string,
  op: Extract<
    ChangeSetItemOperation,
    "archive" | "unarchive" | "trash" | "restore_lifecycle"
  >,
  perform: (
    sb: Awaited<ReturnType<typeof createClient>>,
    userId: string,
    workspaceId: string
  ) => Promise<unknown>,
  beforeStatus: string,
  errorLabel: string
): Promise<ActionResult> {
  const guard = assertNonEmptyId(fileId, "fileId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Branch-aware lifecycle: record intent as a pending op instead
    // of mutating the canonical files row. Branch-local files
    // (`branch_id = activeBranchId`) fall through to the main
    // lifecycle path because they are not yet on main — in-place
    // edits on a draft row are legal. Only main rows get routed to
    // pending ops.
    if (ctx.activeBranchId) {
      const { data: fileRow } = await supabase
        .from("files")
        .select("branch_id")
        .eq("id", fileId)
        .maybeSingle();
      const isBranchLocal = fileRow?.branch_id === ctx.activeBranchId;
      if (!isBranchLocal) {
        const { runLifecycleOnBranchOrMain } = await import(
          "@/server/services/lifecycle_branch_router"
        );
        await runLifecycleOnBranchOrMain({
          supabase,
          branchId: ctx.activeBranchId,
          actorId: ctx.user.id,
          objectType: "file",
          objectId: fileId,
          op,
        });
        revalidatePath(`/app/files/${fileId}`);
        return { ok: true, data: undefined };
      }
    }

    await withLifecycleChangeSet(
      supabase,
      {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        objectType: "file",
        objectId: fileId,
        operation: op,
        beforeStatus,
        afterStatus: lifecycleStatusFor(op),
        summary: `${op} file ${fileId.slice(0, 8)}`,
      },
      async () => { await perform(supabase, ctx.user.id, ctx.workspace.id); }
    );
    revalidatePath(`/app/files/${fileId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : errorLabel };
  }
}

export async function archiveFileAction(fileId: string): Promise<ActionResult> {
  return runFileLifecycle(
    fileId, "archive",
    async (sb, u, w) => archiveFile(sb, u, w, fileId),
    "active", "Failed to archive file"
  );
}

export async function unarchiveFileAction(fileId: string): Promise<ActionResult> {
  return runFileLifecycle(
    fileId, "unarchive",
    async (sb, u, w) => unarchiveFile(sb, u, w, fileId),
    "archived", "Failed to unarchive file"
  );
}

export async function trashFileAction(fileId: string): Promise<ActionResult> {
  return runFileLifecycle(
    fileId, "trash",
    async (sb, u, w) => trashFile(sb, u, w, fileId),
    "active", "Failed to trash file"
  );
}

export async function restoreFileAction(fileId: string): Promise<ActionResult> {
  return runFileLifecycle(
    fileId, "restore_lifecycle",
    async (sb, u, w) => restoreFile(sb, u, w, fileId),
    "trashed", "Failed to restore file"
  );
}

// ─── File rollback ────────────────────────────────────────────────────────────

/**
 * Roll back a file to a prior version.
 * Creates a new version — history is never mutated.
 * Rollback is human-only: not exposed to connections or the API.
 */
export async function rollbackFileAction(
  fileId: string,
  targetVersionId: string
): Promise<ActionResult<{ new_version_id: string; version_number: number }>> {
  const guard = assertNonEmptyId(fileId, "fileId") ?? assertNonEmptyId(targetVersionId, "targetVersionId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const result = await rollbackObjectToVersion(
      supabase,
      ctx.user.id,
      ctx.workspace.id,
      "file",
      fileId,
      targetVersionId
    );
    revalidatePath(`/app/files/${fileId}`);
    return { ok: true, data: { new_version_id: result.new_version_id, version_number: result.version_number } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Rollback failed" };
  }
}
