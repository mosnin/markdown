"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  exportNote,
  exportFolder,
  exportBox,
  exportBundle,
  exportFile,
  exportSkill,
  exportAgent,
} from "@/server/services/export_service";
import {
  deliverExportPackage,
  deliverRawContent,
} from "@/server/services/artifact_delivery_service";
import { importPackage } from "@/server/services/import_service";
import {
  openChangeSet,
  commitChangeSet,
  abortChangeSet,
  recordChangeSetItem,
  recordStructuralEvent,
} from "@/server/services/change_set_service";
import {
  auditNoteExported,
  auditFolderExported,
  auditBoxExported,
  auditBundleExported,
  auditImportCompleted,
} from "@/server/services/audit_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import {
  type CollisionMode,
  type BundleExportOptions,
  type ImportSummaryReport,
  type ExportArtifact,
  type ExportMode,
  type ExportPackage,
  type RawExportContent,
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
          file_count: pkg.manifest.counts.files,
          skill_count: pkg.manifest.counts.skills,
          agent_count: pkg.manifest.counts.agents,
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
          file_count: pkg.manifest.counts.files,
          skill_count: pkg.manifest.counts.skills,
          agent_count: pkg.manifest.counts.agents,
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
          file_count: pkg.manifest.counts.files,
          skill_count: pkg.manifest.counts.skills,
          agent_count: pkg.manifest.counts.agents,
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
          file_count: pkg.manifest.counts.files,
          skill_count: pkg.manifest.counts.skills,
          agent_count: pkg.manifest.counts.agents,
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

    // Every import is wrapped in a change set so the entire import can
    // be undone as one rollback operation. The change set is marked
    // 'open' before the work begins and 'committed' after
    // auditImportCompleted fires; a throw aborts it. The import_service
    // itself doesn't know about change sets yet, so per-object items are
    // recorded after the fact using the ImportAction log the service
    // returns.
    const changeSet = await openChangeSet(supabase, {
      workspace_id: workspaceId,
      origin: "import",
      actor_type: "user",
      actor_id: userId,
      summary: `Import package "${file.name}" into box ${boxId.slice(0, 8)}`,
      metadata: { filename: file.name, collision_mode: collisionMode, box_id: boxId },
    });

    try {
      const report = await importPackage(
        supabase,
        workspaceId,
        userId,
        { buffer, filename: file.name },
        { boxId, targetFolderId },
        collisionMode
      );

      // Record one change_set_item per created/replaced object so a
      // later restore can reason about exactly what this import
      // produced. ImportAction already carries the canonical identity
      // needed; we don't store per-object before_snapshots for
      // 'create' since the prior state was non-existence.
      for (const act of report.actions) {
        if (!act.final_id) continue;
        const op = act.action === "created"
          ? "create"
          : act.action === "replaced" || act.action === "remapped"
            ? "update"
            : null;
        if (!op) continue;
        // ImportAction carries a string object_type whose domain includes
        // non-object_type rows (like link / object_link). Limit to the
        // types a change_set_item can point at.
        const mapped = (
          ["note", "file", "skill", "agent", "folder"] as const
        ).find((t) => t === act.object_type);
        if (!mapped) continue;
        await recordChangeSetItem(supabase, {
          change_set_id: changeSet.id,
          workspace_id: workspaceId,
          operation: op,
          object_type: mapped,
          object_id: act.final_id,
          after_snapshot: { final_path: act.final_path, box_id: boxId },
        });

        // For folders created by the import, also emit a structural
        // `folder_create` event so the restore executor can safely
        // invert the creation (soft-trash) on change-set restore. This
        // is the mechanism that makes "Undo this import" safe when the
        // import built nested folder structure.
        if (mapped === "folder" && op === "create") {
          await recordStructuralEvent(supabase, {
            change_set_id: changeSet.id,
            workspace_id: workspaceId,
            box_id: boxId,
            event_type: "folder_create",
            object_type: "folder",
            object_id: act.final_id,
            before_state: {},
            after_state: {
              final_path: act.final_path,
              box_id: boxId,
            },
          });
        }
      }

      await auditImportCompleted(supabase, workspaceId, userId, boxId, {
        collision_mode: collisionMode,
        created_notes: report.created_counts.notes,
        created_folders: report.created_counts.folders,
        created_links: report.created_counts.links,
        warnings: report.warnings.length,
      });

      await commitChangeSet(supabase, changeSet.id);

      revalidatePath(`/app/boxes/${boxId}`);
      revalidatePath("/app");

      return { ok: true, data: { ...report, change_set_id: changeSet.id } };
    } catch (innerErr) {
      await abortChangeSet(
        supabase,
        changeSet.id,
        innerErr instanceof Error ? innerErr.message : "import failed"
      );
      throw innerErr;
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Import failed",
    };
  }
}

// ─── Export: file ─────────────────────────────────────────────────────────────

export async function exportFileAction(
  fileId: string
): Promise<ActionResult<ExportArtifact>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const adminClient = createAdminClient();

    const pkg = await exportFile(supabase, workspaceId, fileId);
    const delivery = await deliverExportPackage(adminClient, workspaceId, pkg);

    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "file",
      object_id: fileId,
      event_type: "file.exported",
      metadata: null,
    });

    return {
      ok: true,
      data: {
        ...delivery,
        manifest_summary: {
          export_type: pkg.manifest.export_type,
          note_count: 0,
          folder_count: 0,
          link_count: 0,
          file_count: 1,
          skill_count: 0,
          agent_count: 0,
        },
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

// ─── Export: skill ────────────────────────────────────────────────────────────

/**
 * Export a skill.
 * mode = "canonical_source": returns a raw source file download.
 * mode = "packaged" (default): returns a zip with manifest + source file.
 */
export async function exportSkillAction(
  skillId: string,
  mode: ExportMode = "packaged"
): Promise<ActionResult<ExportArtifact>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const adminClient = createAdminClient();

    const result = await exportSkill(supabase, workspaceId, skillId, mode);

    let delivery;
    let exportType = "skill" as const;

    if (mode === "canonical_source") {
      delivery = await deliverRawContent(adminClient, workspaceId, result as RawExportContent);
    } else {
      const pkg = result as ExportPackage;
      delivery = await deliverExportPackage(adminClient, workspaceId, pkg);
      exportType = pkg.manifest.export_type as "skill";
    }

    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "skill",
      object_id: skillId,
      event_type: "skill.exported",
      metadata: { mode },
    });

    return {
      ok: true,
      data: {
        ...delivery,
        manifest_summary: {
          export_type: exportType,
          note_count: 0,
          folder_count: 0,
          link_count: 0,
          file_count: 0,
          skill_count: 1,
          agent_count: 0,
        },
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

// ─── Export: agent ────────────────────────────────────────────────────────────

export async function exportAgentAction(
  agentId: string,
  mode: ExportMode = "packaged"
): Promise<ActionResult<ExportArtifact>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const adminClient = createAdminClient();

    const result = await exportAgent(supabase, workspaceId, agentId, mode);

    let delivery;
    let exportType = "agent" as const;

    if (mode === "canonical_source") {
      delivery = await deliverRawContent(adminClient, workspaceId, result as RawExportContent);
    } else {
      const pkg = result as ExportPackage;
      delivery = await deliverExportPackage(adminClient, workspaceId, pkg);
      exportType = pkg.manifest.export_type as "agent";
    }

    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "agent",
      object_id: agentId,
      event_type: "agent.exported",
      metadata: { mode },
    });

    return {
      ok: true,
      data: {
        ...delivery,
        manifest_summary: {
          export_type: exportType,
          note_count: 0,
          folder_count: 0,
          link_count: 0,
          file_count: 0,
          skill_count: 0,
          agent_count: 1,
        },
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

// ─── Import: workspace-level (skills/agents) ──────────────────────────────────

/**
 * Import a .zip package at workspace level (no box required).
 * For v1.1 packages containing reusable skills/agents.
 * Accepts FormData with fields:
 *   - file: File (.zip only)
 *   - collision_mode: CollisionMode
 */
export async function importWorkspaceLevelPackageAction(
  formData: FormData
): Promise<ActionResult<ImportSummaryReport>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const file = formData.get("file") as File | null;
    const collisionMode = formData.get("collision_mode") as CollisionMode | null;

    if (!file) throw new Error("No file provided.");
    if (!collisionMode) throw new Error("No collision_mode provided.");

    if (!file.name.toLowerCase().endsWith(".zip")) {
      throw new Error("Workspace-level import requires a .zip package.");
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const report = await importPackage(
      supabase,
      workspaceId,
      userId,
      { buffer, filename: file.name },
      { boxId: null, targetFolderId: null },
      collisionMode
    );

    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "workspace",
      object_id: workspaceId,
      event_type: "workspace.import_completed",
      metadata: {
        collision_mode: collisionMode,
        created_skills: report.created_counts.skills,
        created_agents: report.created_counts.agents,
        warnings: report.warnings.length,
      },
    });

    revalidatePath("/app/skills");
    revalidatePath("/app/agents");
    revalidatePath("/app");

    return { ok: true, data: report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Import failed" };
  }
}
