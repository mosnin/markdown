"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  exportNote,
  exportFolder,
  exportBox,
  exportBundle,
} from "@/server/services/export_service";
import { deliverExportPackage } from "@/server/services/artifact_delivery_service";
import { importPackage } from "@/server/services/import_service";
import {
  auditNoteExported,
  auditFolderExported,
  auditBoxExported,
  auditBundleExported,
  auditImportCompleted,
} from "@/server/services/audit_service";
import {
  type CollisionMode,
  type BundleExportOptions,
  type ImportSummaryReport,
  type ExportArtifact,
} from "@/server/domain/types/import_export";

// ─── Action result type ───────────────────────────────────────────────────────

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return { supabase, userId: ctx.user.id, workspaceId: ctx.workspace.id };
}

// ─── Export: note ─────────────────────────────────────────────────────────────

/**
 * Export a single note as a zip package.
 *
 * Packages the note server-side, uploads to private Supabase Storage, and
 * returns a signed download URL valid for 1 hour. The client should trigger
 * a browser download via the signed_url rather than handling raw bytes.
 */
export async function exportNoteAction(
  noteId: string
): Promise<ActionResult<ExportArtifact>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const adminClient = createAdminClient();

    const pkg = await exportNote(supabase, workspaceId, noteId);
    const delivery = await deliverExportPackage(adminClient, workspaceId, pkg);

    await auditNoteExported(supabase, workspaceId, userId, noteId);

    return {
      ok: true,
      data: {
        ...delivery,
        manifest_summary: {
          export_type: pkg.manifest.export_type,
          note_count: pkg.manifest.counts.notes,
          folder_count: pkg.manifest.counts.folders,
          link_count: pkg.manifest.counts.links,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Export failed",
    };
  }
}

// ─── Export: folder ───────────────────────────────────────────────────────────

export async function exportFolderAction(
  folderId: string
): Promise<ActionResult<ExportArtifact>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const adminClient = createAdminClient();

    const pkg = await exportFolder(supabase, workspaceId, folderId);
    const delivery = await deliverExportPackage(adminClient, workspaceId, pkg);

    await auditFolderExported(supabase, workspaceId, userId, folderId, {
      note_count: pkg.manifest.counts.notes,
    });

    return {
      ok: true,
      data: {
        ...delivery,
        manifest_summary: {
          export_type: pkg.manifest.export_type,
          note_count: pkg.manifest.counts.notes,
          folder_count: pkg.manifest.counts.folders,
          link_count: pkg.manifest.counts.links,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Export failed",
    };
  }
}

// ─── Export: box ──────────────────────────────────────────────────────────────

export async function exportBoxAction(
  boxId: string
): Promise<ActionResult<ExportArtifact>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const adminClient = createAdminClient();

    const pkg = await exportBox(supabase, workspaceId, boxId);
    const delivery = await deliverExportPackage(adminClient, workspaceId, pkg);

    await auditBoxExported(supabase, workspaceId, userId, boxId, {
      note_count: pkg.manifest.counts.notes,
      folder_count: pkg.manifest.counts.folders,
    });

    return {
      ok: true,
      data: {
        ...delivery,
        manifest_summary: {
          export_type: pkg.manifest.export_type,
          note_count: pkg.manifest.counts.notes,
          folder_count: pkg.manifest.counts.folders,
          link_count: pkg.manifest.counts.links,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Export failed",
    };
  }
}

// ─── Export: context bundle ───────────────────────────────────────────────────

export async function exportBundleAction(
  noteId: string,
  options?: BundleExportOptions
): Promise<ActionResult<ExportArtifact>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const adminClient = createAdminClient();

    const pkg = await exportBundle(supabase, workspaceId, noteId, options);
    const delivery = await deliverExportPackage(adminClient, workspaceId, pkg);

    await auditBundleExported(supabase, workspaceId, userId, noteId, {
      note_count: pkg.manifest.counts.notes,
      truncated: pkg.manifest.bundle?.truncated ?? false,
    });

    return {
      ok: true,
      data: {
        ...delivery,
        manifest_summary: {
          export_type: pkg.manifest.export_type,
          note_count: pkg.manifest.counts.notes,
          folder_count: pkg.manifest.counts.folders,
          link_count: pkg.manifest.counts.links,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Export failed",
    };
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Import a .md or .zip package into a box.
 * Accepts FormData with fields:
 *   - file: File
 *   - box_id: string
 *   - collision_mode: CollisionMode
 *   - target_folder_id?: string (optional)
 */
export async function importPackageAction(
  formData: FormData
): Promise<ActionResult<ImportSummaryReport>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const file = formData.get("file") as File | null;
    const boxId = formData.get("box_id") as string | null;
    const collisionMode = formData.get("collision_mode") as CollisionMode | null;
    const targetFolderId = (formData.get("target_folder_id") as string | null) || null;

    if (!file) throw new Error("No file provided.");
    if (!boxId) throw new Error("No box_id provided.");
    if (!collisionMode) throw new Error("No collision_mode provided.");

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const report = await importPackage(
      supabase,
      workspaceId,
      userId,
      { buffer, filename: file.name },
      { boxId, targetFolderId },
      collisionMode
    );

    await auditImportCompleted(supabase, workspaceId, userId, boxId, {
      collision_mode: collisionMode,
      created_notes: report.created_counts.notes,
      created_folders: report.created_counts.folders,
      created_links: report.created_counts.links,
      warnings: report.warnings.length,
    });

    return { ok: true, data: report };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Import failed",
    };
  }
}
