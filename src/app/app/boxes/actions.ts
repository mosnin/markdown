"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createBox, updateBox } from "@/server/services/box_service";
import { createFolder, renameFolder } from "@/server/services/folder_service";
import { createNote } from "@/server/services/note_service";
import { assignGuideNote, clearGuideNote } from "@/server/services/guide_service";
import { searchNotes, type NoteSearchResult } from "@/server/services/search_service";
import { applyBoxTemplate } from "@/server/services/template_service";
import { auditNoteCreatedFromTemplate } from "@/server/services/audit_service";
import { checkNoteLimit, checkBoxLimit } from "@/server/services/subscription_service";

export type ActionResult<T = void> =
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

// ─── Box actions ──────────────────────────────────────────────────────────────

export async function createBoxAction(
  name: string,
  description?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const boxLimit = await checkBoxLimit(supabase, workspaceId);
    if (!boxLimit.allowed) {
      return {
        ok: false,
        error: "Box limit reached. Upgrade to Pro for unlimited boxes.",
      };
    }

    const box = await createBox(supabase, userId, workspaceId, {
      name: name.trim(),
      description: description?.trim() ?? null,
    });
    revalidatePath("/app");
    return { ok: true, data: { id: box.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create box" };
  }
}

export async function updateBoxAction(
  boxId: string,
  changes: { name?: string; description?: string | null }
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await updateBox(supabase, userId, boxId, workspaceId, changes);
    revalidatePath(`/app/boxes/${boxId}`);
    revalidatePath("/app");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update box" };
  }
}

// ─── Folder actions ───────────────────────────────────────────────────────────

export async function createFolderAction(
  boxId: string,
  name: string,
  parentFolderId?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const folder = await createFolder(supabase, userId, workspaceId, {
      boxId,
      name: name.trim(),
      parentFolderId: parentFolderId ?? null,
    });
    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: folder.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create folder" };
  }
}

export async function renameFolderAction(
  folderId: string,
  boxId: string,
  newName: string
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await renameFolder(supabase, userId, workspaceId, folderId, newName.trim());
    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename folder" };
  }
}

// ─── Note actions (from box page) ─────────────────────────────────────────────

export async function createNoteAction(
  boxId: string,
  title: string,
  folderId?: string | null,
  kind: "note" | "guide" | "bundle" = "note",
  markdownContent?: string,
  templateId?: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const noteLimit = await checkNoteLimit(supabase, workspaceId);
    if (!noteLimit.allowed) {
      return {
        ok: false,
        error: "Note limit reached. Upgrade to Pro for unlimited notes.",
      };
    }

    const note = await createNote(supabase, userId, workspaceId, {
      boxId,
      folderId: folderId ?? null,
      title: title.trim(),
      kind,
      markdownContent: markdownContent ?? "",
    });
    if (templateId) {
      auditNoteCreatedFromTemplate(supabase, workspaceId, userId, note.id, {
        template_id: templateId,
        title: note.title,
        box_id: boxId,
      });
    }
    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: note.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create note" };
  }
}

/**
 * Apply a box template: create folders and notes with canonical metadata
 * defaults, optionally assign the guide note, and fire an audit event.
 * Delegates to template_service — does not bypass versioning or audit.
 */
export async function applyBoxTemplateAction(
  boxId: string,
  templateId: string
): Promise<ActionResult<{ guideNoteId: string | null }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const result = await applyBoxTemplate(supabase, userId, workspaceId, boxId, templateId);
    revalidatePath(`/app/boxes/${boxId}`);
    revalidatePath("/app");
    return { ok: true, data: { guideNoteId: result.guideNoteId } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to apply template",
    };
  }
}

// ─── Guide note actions ───────────────────────────────────────────────────────

export async function assignGuideNoteAction(
  boxId: string,
  noteId: string
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await assignGuideNote(supabase, userId, workspaceId, boxId, noteId);
    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to assign guide note" };
  }
}

export async function clearGuideNoteAction(boxId: string): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await clearGuideNote(supabase, userId, workspaceId, boxId);
    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to clear guide note" };
  }
}

// ─── Search action ────────────────────────────────────────────────────────────

export async function searchNotesAction(
  boxId: string,
  query: string
): Promise<ActionResult<NoteSearchResult[]>> {
  try {
    const { supabase } = await requireContext();
    const results = await searchNotes(supabase, boxId, query);
    return { ok: true, data: results };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Search failed",
    };
  }
}

// ─── Box tree action ──────────────────────────────────────────────────────────

/**
 * Fetch the folder and note tree for a box.
 * Used by the sidebar tree component to lazily load tree data.
 */
export async function getBoxTreeAction(boxId: string): Promise<ActionResult<{
  folders: Array<{ id: string; name: string; parent_folder_id: string | null; status: string }>;
  notes: Array<{ id: string; title: string; kind: string; folder_id: string | null }>;
}>> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const { getBoxById } = await import("@/server/repositories/box_repository");
    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Box not found" };
    }
    const { listFoldersByBox } = await import("@/server/repositories/folder_repository");
    const { listNotesByBox } = await import("@/server/repositories/note_repository");
    const [folders, notes] = await Promise.all([
      listFoldersByBox(supabase, boxId),
      listNotesByBox(supabase, boxId),
    ]);
    return {
      ok: true,
      data: {
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          parent_folder_id: f.parent_folder_id,
          status: f.status,
        })),
        notes: notes.map((n) => ({
          id: n.id,
          title: n.title,
          kind: n.kind,
          folder_id: n.folder_id,
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load tree" };
  }
}
