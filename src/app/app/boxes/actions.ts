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
 *
 * Skills and agents include a `status` field so the sidebar can render archived
 * items with reduced opacity. Trashed attached objects are excluded.
 */
export async function getBoxTreeAction(boxId: string): Promise<ActionResult<{
  folders: Array<{ id: string; name: string; parent_folder_id: string | null; status: string }>;
  notes: Array<{ id: string; title: string; kind: string; folder_id: string | null }>;
  files: Array<{ id: string; name: string; file_extension: string | null; folder_id: string | null }>;
  skills: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean }>;
  agents: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean }>;
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
      listSkillsByBox(supabase, boxId, { includeArchived: true }),
      listAgentsByBox(supabase, boxId, { includeArchived: true }),
      listAttachmentsForBox(supabase, boxId),
    ]);

    // Resolve attached reusable skills and agents by id
    const attachedSkillIds = attachments
      .filter((a) => a.object_type === "skill")
      .map((a) => a.object_id);
    const attachedAgentIds = attachments
      .filter((a) => a.object_type === "agent")
      .map((a) => a.object_id);
    const [attachedSkillsRaw, attachedAgentsRaw] = await Promise.all([
      getSkillsByIds(supabase, attachedSkillIds),
      getAgentsByIds(supabase, attachedAgentIds),
    ]);

    // Exclude trashed attached objects — archived ones still show (dimmed in sidebar)
    const attachedSkills = attachedSkillsRaw.filter((s) => s.status !== "trashed");
    const attachedAgents = attachedAgentsRaw.filter((a) => a.status !== "trashed");

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
            status: s.status,
            is_reusable: s.is_reusable,
            is_attachment: false,
          })),
          ...attachedSkills.map((s) => ({
            id: s.id,
            name: s.name,
            folder_id: skillAttachmentFolderById.get(s.id) ?? null,
            status: s.status,
            is_reusable: true,
            is_attachment: true,
          })),
        ],
        agents: [
          ...localAgents.map((a) => ({
            id: a.id,
            name: a.name,
            folder_id: a.folder_id,
            status: a.status,
            is_reusable: a.is_reusable,
            is_attachment: false,
          })),
          ...attachedAgents.map((a) => ({
            id: a.id,
            name: a.name,
            folder_id: agentAttachmentFolderById.get(a.id) ?? null,
            status: a.status,
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

// ─── Attachment actions ───────────────────────────────────────────────────────

/**
 * Attach a workspace-level reusable skill to a box by reference.
 * No-op safe: if already attached, returns the existing attachment id.
 * The skill is not copied — changes to the source are reflected in all boxes.
 */
export async function attachSkillToBoxAction(
  boxId: string,
  skillId: string,
  folderId?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const { getBoxById } = await import("@/server/repositories/box_repository");
    const { getSkillById } = await import("@/server/repositories/skill_repository");
    const {
      isObjectAttachedToBox,
      createAttachment,
      listAttachmentsForBox,
    } = await import("@/server/repositories/box_object_attachment_repository");

    const [box, skill] = await Promise.all([
      getBoxById(supabase, boxId),
      getSkillById(supabase, skillId),
    ]);
    if (!box || box.workspace_id !== workspaceId) return { ok: false, error: "Box not found" };
    if (!skill || skill.workspace_id !== workspaceId) return { ok: false, error: "Skill not found" };
    if (!skill.is_reusable) return { ok: false, error: "Only workspace-level reusable skills can be attached" };
    if (skill.status === "trashed") return { ok: false, error: "Cannot attach a trashed skill" };

    // Return existing attachment silently if already present
    const alreadyAttached = await isObjectAttachedToBox(supabase, boxId, "skill", skillId);
    if (alreadyAttached) {
      const existing = await listAttachmentsForBox(supabase, boxId);
      const row = existing.find((a) => a.object_type === "skill" && a.object_id === skillId);
      return { ok: true, data: { id: row?.id ?? skillId } };
    }

    const attachment = await createAttachment(supabase, {
      workspace_id: workspaceId,
      box_id: boxId,
      folder_id: folderId ?? null,
      object_type: "skill",
      object_id: skillId,
      attached_by: userId,
    });

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: attachment.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to attach skill" };
  }
}

/**
 * Attach a workspace-level reusable agent to a box by reference.
 * No-op safe: if already attached, returns the existing attachment id.
 * The agent is not copied — changes to the source are reflected in all boxes.
 */
export async function attachAgentToBoxAction(
  boxId: string,
  agentId: string,
  folderId?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const { getBoxById } = await import("@/server/repositories/box_repository");
    const { getAgentById } = await import("@/server/repositories/agent_repository");
    const {
      isObjectAttachedToBox,
      createAttachment,
      listAttachmentsForBox,
    } = await import("@/server/repositories/box_object_attachment_repository");

    const [box, agent] = await Promise.all([
      getBoxById(supabase, boxId),
      getAgentById(supabase, agentId),
    ]);
    if (!box || box.workspace_id !== workspaceId) return { ok: false, error: "Box not found" };
    if (!agent || agent.workspace_id !== workspaceId) return { ok: false, error: "Agent not found" };
    if (!agent.is_reusable) return { ok: false, error: "Only workspace-level reusable agents can be attached" };
    if (agent.status === "trashed") return { ok: false, error: "Cannot attach a trashed agent" };

    const alreadyAttached = await isObjectAttachedToBox(supabase, boxId, "agent", agentId);
    if (alreadyAttached) {
      const existing = await listAttachmentsForBox(supabase, boxId);
      const row = existing.find((a) => a.object_type === "agent" && a.object_id === agentId);
      return { ok: true, data: { id: row?.id ?? agentId } };
    }

    const attachment = await createAttachment(supabase, {
      workspace_id: workspaceId,
      box_id: boxId,
      folder_id: folderId ?? null,
      object_type: "agent",
      object_id: agentId,
      attached_by: userId,
    });

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: attachment.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to attach agent" };
  }
}

/**
 * Detach a reusable skill or agent from a box.
 * Removes the reference only — the source object and its attachments in
 * other boxes are not affected.
 */
export async function detachFromBoxAction(
  boxId: string,
  objectType: "skill" | "agent",
  objectId: string
): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const { getBoxById } = await import("@/server/repositories/box_repository");
    const { deleteAttachmentForObject } = await import("@/server/repositories/box_object_attachment_repository");

    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== workspaceId) return { ok: false, error: "Box not found" };

    await deleteAttachmentForObject(supabase, boxId, objectType, objectId);
    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to detach" };
  }
}

/**
 * Fetch workspace-level reusable skills and agents not yet attached to a given box.
 * Used to populate the "Attach reusable" dialog.
 */
export async function getAttachablesToBoxAction(boxId: string): Promise<ActionResult<{
  skills: Array<{ id: string; name: string; description: string | null; canonical_format: string; status: string }>;
  agents: Array<{ id: string; name: string; description: string | null; canonical_format: string; agent_type: string | null; status: string }>;
}>> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const { getBoxById } = await import("@/server/repositories/box_repository");
    const { listReusableSkills } = await import("@/server/repositories/skill_repository");
    const { listReusableAgents } = await import("@/server/repositories/agent_repository");
    const { listAttachmentsForBox } = await import("@/server/repositories/box_object_attachment_repository");

    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== workspaceId) return { ok: false, error: "Box not found" };

    const [allSkills, allAgents, attachments] = await Promise.all([
      listReusableSkills(supabase, workspaceId),
      listReusableAgents(supabase, workspaceId),
      listAttachmentsForBox(supabase, boxId),
    ]);

    const attachedSkillIds = new Set(
      attachments.filter((a) => a.object_type === "skill").map((a) => a.object_id)
    );
    const attachedAgentIds = new Set(
      attachments.filter((a) => a.object_type === "agent").map((a) => a.object_id)
    );

    return {
      ok: true,
      data: {
        skills: allSkills
          .filter((s) => !attachedSkillIds.has(s.id))
          .map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            canonical_format: s.canonical_format,
            status: s.status,
          })),
        agents: allAgents
          .filter((a) => !attachedAgentIds.has(a.id))
          .map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            canonical_format: a.canonical_format,
            agent_type: a.agent_type,
            status: a.status,
          })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load attachables" };
  }
}
