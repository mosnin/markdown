"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import { importWorkspace } from "@/server/services/workspace_export_service";
import { type WorkspaceExport, type WorkspaceImportResult } from "@/server/domain/types/workspace_export";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Server action: import a workspace JSON payload.
 */
export async function importWorkspaceAction(
  jsonString: string,
  collisionMode: "skip" | "overwrite",
): Promise<ActionResult<WorkspaceImportResult>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  let data: WorkspaceExport;
  try {
    data = JSON.parse(jsonString) as WorkspaceExport;
  } catch {
    return { ok: false, error: "Invalid JSON file" };
  }

  if (!data.version || !data.boxes || !data.notes) {
    return { ok: false, error: "Invalid workspace export format" };
  }

  try {
    const supabase = await createClient();
    const result = await importWorkspace(
      supabase,
      ctx.workspace.id,
      ctx.user.id,
      data,
      collisionMode,
    );
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return { ok: false, error: message };
  }
}
