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

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Guard: reject blank / non-string IDs before hitting the service layer.
function assertNonEmptyId(id: string, label: string): { ok: false; error: string } | null {
  if (!id || id.trim() === "") return { ok: false, error: `${label} is required` };
  return null;
}

// ─── File lifecycle ───────────────────────────────────────────────────────────

export async function archiveFileAction(fileId: string): Promise<ActionResult> {
  const guard = assertNonEmptyId(fileId, "fileId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await archiveFile(supabase, ctx.user.id, ctx.workspace.id, fileId);
    revalidatePath(`/app/files/${fileId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to archive file" };
  }
}

export async function unarchiveFileAction(fileId: string): Promise<ActionResult> {
  const guard = assertNonEmptyId(fileId, "fileId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await unarchiveFile(supabase, ctx.user.id, ctx.workspace.id, fileId);
    revalidatePath(`/app/files/${fileId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to unarchive file" };
  }
}

export async function trashFileAction(fileId: string): Promise<ActionResult> {
  const guard = assertNonEmptyId(fileId, "fileId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await trashFile(supabase, ctx.user.id, ctx.workspace.id, fileId);
    revalidatePath(`/app/files/${fileId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash file" };
  }
}

export async function restoreFileAction(fileId: string): Promise<ActionResult> {
  const guard = assertNonEmptyId(fileId, "fileId");
  if (guard) return guard;
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    await restoreFile(supabase, ctx.user.id, ctx.workspace.id, fileId);
    revalidatePath(`/app/files/${fileId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to restore file" };
  }
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
