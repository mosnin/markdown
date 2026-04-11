"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  createFile,
  updateFileContent,
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
  return { supabase, userId: ctx.user.id, workspaceId: ctx.workspace.id };
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
    const { supabase, userId, workspaceId } = await requireContext();
    const file = await updateFileContent(supabase, userId, workspaceId, fileId, params);
    return { ok: true, data: { id: file.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save file",
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
    const { supabase, workspaceId } = await requireContext();
    const existing = await getFileForWorkspace(supabase, fileId, workspaceId);
    if (!existing) return { ok: false, error: "File not found" };

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
    const { supabase, workspaceId } = await requireContext();
    const link = await createLink(supabase, workspaceId, {
      sourceObjectType: OBJECT_TYPE.FILE,
      sourceObjectId: fileId,
      targetObjectType,
      targetObjectId,
      relationshipType,
      relationshipNote: relationshipNote ?? null,
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
    const { supabase, workspaceId } = await requireContext();
    await removeLink(supabase, workspaceId, linkId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete link",
    };
  }
}
