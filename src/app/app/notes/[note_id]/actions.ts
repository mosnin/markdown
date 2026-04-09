"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { rollbackNoteToVersion } from "@/server/services/version_history_service";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Roll back a note to a selected prior version.
 *
 * Human-only. Not available to external connections or MCP in V1.
 *
 * Creates a new note_version (change_origin='rollback') from the selected
 * historical snapshot. The target version row is never mutated.
 *
 * Returns the new version id and version number on success.
 */
export async function rollbackNoteAction(
  noteId: string,
  targetVersionId: string
): Promise<ActionResult<{ new_version_id: string; version_number: number }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const adminClient = createAdminClient();

    const result = await rollbackNoteToVersion(
      adminClient,
      ctx.user!.id,
      ctx.workspace.id,
      noteId,
      targetVersionId
    );

    return {
      success: true,
      data: {
        new_version_id: result.new_version_id,
        version_number: result.version_number,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rollback failed";
    return { success: false, error: message };
  }
}
