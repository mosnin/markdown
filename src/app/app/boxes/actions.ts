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

    // Revalidation strategy after box creation:
    //   /app          — home dashboard (stats tiles) + app layout (sidebar box list).
    //                   revalidatePath('/app') invalidates the /app page AND the
    //                   ancestor layout tags (_N_T_/app/layout), which forces
    //                   listBoxesByWorkspace() to re-run so the new box appears
    //                   in the sidebar on the next navigation.
    //   /app/workspaces — box list page (was previously missing; showed stale count).
    // The new box page itself doesn't need revalidation — it's a fresh route.
    revalidatePath("/app");
    revalidatePath("/app/workspaces");

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
 * Fetch the full mixed-object tree for a box.
 * Returns folders, notes, files, skills, and agents (both box-local and
 * workspace-level reusable attachments). Used by the sidebar tree component
 * to lazily load tree data per box.
 */
export async function getBoxTreeAction(boxId: string): Promise<ActionResult<{
  folders: Array<{ id: string; name: string; parent_folder_id: string | null; status: string }>;
  notes: Array<{ id: string; title: string; kind: string; folder_id: string | null }>;
  files: Array<{ id: string; name: string; file_extension: string | null; folder_id: string | null }>;
  skills: Array<{ id: string; name: string; folder_id: string | null; is_reusable: boolean; is_attachment: boolean }>;
  agents: Array<{ id: string; name: string; folder_id: string | null; is_reusable: boolean; is_attachment: boolean }>;
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
    const { listFilesByBox } = await import("@/server/repositories/file_repository");
    const { listSkillsByBox, getSkillsByIds } = await import("@/server/repositories/skill_repository");
    const { listAgentsByBox, getAgentsByIds } = await import("@/server/repositories/agent_repository");
    const { listAttachmentsForBox } = await import("@/server/repositories/box_object_attachment_repository");

    const [folders, notes, files, localSkills, localAgents, attachments] = await Promise.all([
      listFoldersByBox(supabase, boxId),
      listNotesByBox(supabase, boxId),
      listFilesByBox(supabase, boxId),
      listSkillsByBox(supabase, boxId),
      listAgentsByBox(supabase, boxId),
      listAttachmentsForBox(supabase, boxId),
    ]);

    // Resolve attached reusable skills and agents by id
    const attachedSkillIds = attachments
      .filter((a) => a.object_type === "skill")
      .map((a) => a.object_id);
    const attachedAgentIds = attachments
      .filter((a) => a.object_type === "agent")
      .map((a) => a.object_id);
    const [attachedSkills, attachedAgents] = await Promise.all([
      getSkillsByIds(supabase, attachedSkillIds),
      getAgentsByIds(supabase, attachedAgentIds),
    ]);

    // Build lookup maps for attachment folder placement
    const skillAttachmentFolderById = new Map(
      attachments
        .filter((a) => a.object_type === "skill")
        .map((a) => [a.object_id, a.folder_id ?? null])
    );
    const agentAttachmentFolderById = new Map(
      attachments
        .filter((a) => a.object_type === "agent")
        .map((a) => [a.object_id, a.folder_id ?? null])
    );

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
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          file_extension: f.file_extension,
          folder_id: f.folder_id,
        })),
        skills: [
          ...localSkills.map((s) => ({
            id: s.id,
            name: s.name,
            folder_id: s.folder_id,
            is_reusable: s.is_reusable,
            is_attachment: false,
          })),
          ...attachedSkills.map((s) => ({
            id: s.id,
            name: s.name,
            folder_id: skillAttachmentFolderById.get(s.id) ?? null,
            is_reusable: true,
            is_attachment: true,
          })),
        ],
        agents: [
          ...localAgents.map((a) => ({
            id: a.id,
            name: a.name,
            folder_id: a.folder_id,
            is_reusable: a.is_reusable,
            is_attachment: false,
          })),
          ...attachedAgents.map((a) => ({
            id: a.id,
            name: a.name,
            folder_id: agentAttachmentFolderById.get(a.id) ?? null,
            is_reusable: true,
            is_attachment: true,
          })),
        ],
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load tree" };
  }
}
