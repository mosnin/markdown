"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import { importWorkspace, validateExportSchema } from "@/server/services/workspace_export_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { type WorkspaceExport, type WorkspaceImportResult } from "@/server/domain/types/workspace_export";

/** Maximum import payload size: 50 MB. */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

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

  // Reject oversized payloads before parsing
  if (new TextEncoder().encode(jsonString).byteLength > MAX_IMPORT_BYTES) {
    return { ok: false, error: "Import file exceeds the 50 MB size limit" };
  }

  let data: WorkspaceExport;
  try {
    data = JSON.parse(jsonString) as WorkspaceExport;
  } catch {
    return { ok: false, error: "Invalid JSON file" };
  }

  try {
    validateExportSchema(data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid workspace export format" };
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

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "workspace.imported",
      metadata: {
        collision_mode: collisionMode,
        boxes_created: result.boxes.created,
        notes_created: result.notes.created,
        folders_created: result.folders.created,
        files_created: result.files.created,
        warnings: result.warnings.length,
      },
    });

    revalidatePath("/app");
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return { ok: false, error: message };
  }
}
