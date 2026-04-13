"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  createFile,
  updateFileContent,
  updateFileContentOnBranch,
  getFileForWorkspace,
} from "@/server/services/file_service";
import {
  createLink,
  removeLink,
} from "@/server/services/object_link_service";
import { getBoxById } from "@/server/repositories/box_repository";
import { OBJECT_TYPE, type SourceFormat, type ObjectType } from "@/server/domain/constants/object_constants";
import { type RelationshipType } from "@/server/domain/constants/note_constants";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return {
    supabase,
    userId: ctx.user.id,
    workspaceId: ctx.workspace.id,
    activeBranchId: ctx.activeBranchId,
  };
}

// ─── Field guards ─────────────────────────────────────────────────────────────

const MAX_CONTENT_LENGTH = 500_000;
const MAX_FILENAME_LENGTH = 255;

// ─── File save ────────────────────────────────────────────────────────────────

/**
 * Save updated file content and create a new immutable version.
 * Delegates to updateFileContent → update_object_and_create_version RPC.
 */
export async function saveFileAction(
  fileId: string,
  params: {
    sourceContent: string;
    description?: string | null;
    tags?: string[];
    summary?: string | null;
  }
): Promise<ActionResult<{ id: string }>> {
  if (params.sourceContent.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Content must not exceed ${MAX_CONTENT_LENGTH} characters`,
    };
  }
  try {
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
    if (activeBranchId) {
      // Branch save — writes a new object_versions row and upserts
      // branch_heads. Main's `files.current_version_id` is untouched.
      // Non-versioned fields (description, tags, summary) are NOT
      // persisted on the branch in V1 — they stay on main until
      // promote. This keeps the branch contract narrow and honest.
      await updateFileContentOnBranch(
        supabase, userId, workspaceId, activeBranchId, fileId, params.sourceContent
      );
      return { ok: true, data: { id: fileId } };
    }
    const file = await updateFileContent(supabase, userId, workspaceId, fileId, params);
    return { ok: true, data: { id: file.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save file",
    };
  }
}

// ─── File-level import (replace or append) ────────────────────────────────────

/**
 * Import content from an uploaded file into an existing File object.
 *
 * Modes:
 *   - "replace": the uploaded content replaces the current source_content
 *   - "append":  the uploaded content is appended to the current content,
 *                preserving the original with a separator
 *
 * Either way, the write flows through updateFileContent → the
 * update_object_and_create_version RPC, which creates a new immutable
 * object_versions row and fires the audit event. Trust, lifecycle,
 * versioning, and identity are preserved end-to-end.
 *
 * Works for every scope: box-local files, files in folders, child files
 * of box-local Skills/Agents, and child files of reusable workspace-
 * level Skills/Agents (because getFileForWorkspace / updateFileContent
 * verify ownership via workspace_id when box_id is null).
 */
export async function importIntoFileAction(
  fileId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) {
      return { ok: false, error: "No file uploaded" };
    }

    const modeRaw = formData.get("mode");
    const mode = modeRaw === "append" ? "append" : "replace";

    // Enforce a reasonable size limit. 5 MB is well over the editor's
    // practical ceiling but below anything that would crash the server.
    const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
    if (uploaded.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "Upload must be 5MB or smaller" };
    }

    const rawText = await uploaded.text();
    if (rawText.length > MAX_CONTENT_LENGTH) {
      return {
        ok: false,
        error: `Uploaded content must not exceed ${MAX_CONTENT_LENGTH} characters`,
      };
    }

    const existing = await getFileForWorkspace(supabase, fileId, workspaceId);
    if (!existing) {
      return { ok: false, error: "File not found" };
    }

    const nextContent =
      mode === "append"
        ? `${existing.source_content}\n\n${rawText}`
        : rawText;

    if (nextContent.length > MAX_CONTENT_LENGTH) {
      return {
        ok: false,
        error: `Resulting content must not exceed ${MAX_CONTENT_LENGTH} characters`,
      };
    }

    const updated = await updateFileContent(
      supabase,
      userId,
      workspaceId,
      fileId,
      { sourceContent: nextContent },
    );

    // Revalidate the file page and any parent surface that might
    // display the file's summary or size.
    revalidatePath(`/app/files/${fileId}`);
    if (existing.box_id) revalidatePath(`/app/boxes/${existing.box_id}`);
    if (existing.parent_skill_id) revalidatePath(`/app/skills/${existing.parent_skill_id}`);
    if (existing.parent_agent_id) revalidatePath(`/app/agents/${existing.parent_agent_id}`);

    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to import into file",
    };
  }
}

// ─── File creation ────────────────────────────────────────────────────────────

/**
 * Create a file in a box with an explicit source format.
 * The canonical format is fixed at creation — it cannot be changed later
 * except through an explicit conversion (not implemented in this version).
 */
export async function createFileInBoxAction(
  boxId: string,
  params: {
    filename: string;
    canonicalFormat: SourceFormat;
    fileExtension: string | null;
    sourceLanguage: string | null;
    mimeType?: string | null;
    folderId?: string | null;
    initialContent?: string;
  }
): Promise<ActionResult<{ id: string }>> {
  const name = params.filename.trim();
  if (!name) {
    return { ok: false, error: "Filename is required" };
  }
  if (name.length > MAX_FILENAME_LENGTH) {
    return { ok: false, error: `Filename must not exceed ${MAX_FILENAME_LENGTH} characters` };
  }
  if (/[/\\]/.test(name)) {
    return { ok: false, error: "Filename must not contain slashes" };
  }

  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Box not found" };
    }

    const file = await createFile(supabase, userId, workspaceId, {
      boxId,
      folderId: params.folderId ?? null,
      name,
      sourceContent: params.initialContent ?? "",
      canonicalFormat: params.canonicalFormat,
      sourceLanguage: params.sourceLanguage,
      fileExtension: params.fileExtension,
      mimeType: params.mimeType ?? null,
    });

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: file.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create file",
    };
  }
}

// ─── File lifecycle ───────────────────────────────────────────────────────────

/**
 * Update the lifecycle status of a file (draft / active / archived / trashed).
 * Preserved under the same trust model as notes.
 */
export async function updateFileStatusAction(
  fileId: string,
  status: "draft" | "active" | "archived" | "trashed"
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
    const existing = await getFileForWorkspace(supabase, fileId, workspaceId);
    if (!existing) return { ok: false, error: "File not found" };

    // Branch-aware lifecycle: when the user is editing on a draft
    // branch we must not mutate the canonical files row directly.
    // Branch-created files (branch_id matches the active branch)
    // can still be updated in place — they are not on main yet. For
    // a canonical (main) row, record a pending op instead so promote
    // applies the transition and discard drops it.
    if (activeBranchId && existing.branch_id !== activeBranchId) {
      // Only archive / unarchive / trash / restore are modelled as
      // pending ops. `draft` isn't a lifecycle op we branch-route —
      // it falls through to main as before.
      if (status === "archived" || status === "trashed" ||
          (status === "active" &&
            (existing.status === "archived" || existing.status === "trashed"))) {
        const { runLifecycleOnBranchOrMain } = await import(
          "@/server/services/lifecycle_branch_router"
        );
        const op =
          status === "archived" ? "archive" as const :
          status === "trashed" ? "trash" as const :
          existing.status === "archived" ? "unarchive" as const :
          "restore_lifecycle" as const;
        await runLifecycleOnBranchOrMain({
          supabase,
          branchId: activeBranchId,
          actorId: userId,
          objectType: "file",
          objectId: fileId,
          op,
        });
        return { ok: true, data: undefined };
      }
    }

    const { updateFile } = await import("@/server/repositories/file_repository");
    await updateFile(supabase, fileId, { status });

    if (existing.box_id) {
      revalidatePath(`/app/boxes/${existing.box_id}`);
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update file status",
    };
  }
}

// ─── File object links ────────────────────────────────────────────────────────

/**
 * Create a directed semantic relationship from this file to another object.
 * Uses the object_links table which supports heterogeneous source/target types.
 */
export async function createFileObjectLinkAction(
  fileId: string,
  targetObjectType: ObjectType,
  targetObjectId: string,
  relationshipType: RelationshipType,
  relationshipNote?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, workspaceId, activeBranchId } = await requireContext();
    const link = await createLink(supabase, workspaceId, {
      sourceObjectType: OBJECT_TYPE.FILE,
      sourceObjectId: fileId,
      targetObjectType,
      targetObjectId,
      relationshipType,
      relationshipNote: relationshipNote ?? null,
      branchId: activeBranchId ?? null,
    });
    return { ok: true, data: { id: link.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create link",
    };
  }
}

/**
 * Delete a file object link by id.
 * Only outgoing links (where the file is the source) should be deletable via the UI.
 */
export async function deleteFileObjectLinkAction(
  linkId: string
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
    if (activeBranchId) {
      const { data: existing } = await supabase
        .from("object_links")
        .select("id, branch_id, workspace_id")
        .eq("id", linkId)
        .maybeSingle();
      if (!existing || existing.workspace_id !== workspaceId) {
        return { ok: false, error: "Link not found" };
      }
      if (existing.branch_id === activeBranchId) {
        await removeLink(supabase, workspaceId, linkId);
      } else if (existing.branch_id === null) {
        const { recordPendingOp } = await import(
          "@/server/services/pending_op_service"
        );
        await recordPendingOp(supabase, {
          branchId: activeBranchId,
          actorId: userId,
          opType: "detach",
          objectType: "object_link",
          objectId: linkId,
        });
      } else {
        return { ok: false, error: "Link belongs to another branch" };
      }
      return { ok: true, data: undefined };
    }
    await removeLink(supabase, workspaceId, linkId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete link",
    };
  }
}
