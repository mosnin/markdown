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
  folders: Array<{ id: string; name: string; parent_folder_id: string | null; status: string; sort_order: number }>;
  notes: Array<{ id: string; title: string; kind: string; folder_id: string | null; status: string; sort_order: number }>;
  files: Array<{ id: string; name: string; file_extension: string | null; folder_id: string | null; status: string; sort_order: number }>;
  skills: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean; sort_order: number }>;
  agents: Array<{ id: string; name: string; folder_id: string | null; status: string; is_reusable: boolean; is_attachment: boolean; sort_order: number }>;
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
    const { data: registryRows } = await supabase
      .from("workspace_objects")
      .select("object_type, object_id, sort_order")
      .eq("box_id", boxId);
    const sortOrder = new Map<string, number>();
    for (const row of registryRows ?? []) {
      sortOrder.set(`${row.object_type}:${row.object_id}`, row.sort_order ?? 0);
    }

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
          sort_order: sortOrder.get(`folder:${f.id}`) ?? 0,
        })),
        notes: notes.map((n) => ({
          id: n.id,
          title: n.title,
          kind: n.kind,
          folder_id: n.folder_id,
          status: n.status,
          sort_order: sortOrder.get(`note:${n.id}`) ?? 0,
        })),
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          file_extension: f.file_extension,
          folder_id: f.folder_id,
          status: f.status,
          sort_order: sortOrder.get(`file:${f.id}`) ?? 0,
        })),
        skills: [
          ...localSkills.map((s) => ({
            id: s.id,
            name: s.name,
            folder_id: s.folder_id,
            status: s.status,
            is_reusable: s.is_reusable,
            is_attachment: false,
            sort_order: sortOrder.get(`skill:${s.id}`) ?? 0,
          })),
          ...attachedSkills.map((s) => ({
            id: s.id,
            name: s.name,
            folder_id: skillAttachmentFolderById.get(s.id) ?? null,
            status: s.status,
            is_reusable: true,
            is_attachment: true,
            sort_order: attachments.find((a) => a.object_type === "skill" && a.object_id === s.id)?.sort_order ?? 0,
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
            sort_order: sortOrder.get(`agent:${a.id}`) ?? 0,
          })),
          ...attachedAgents.map((a) => ({
            id: a.id,
            name: a.name,
            folder_id: agentAttachmentFolderById.get(a.id) ?? null,
            status: a.status,
            is_reusable: true,
            is_attachment: true,
            sort_order: attachments.find((at) => at.object_type === "agent" && at.object_id === a.id)?.sort_order ?? 0,
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

type TreeObjectType = "folder" | "note" | "file" | "skill" | "agent";
type MovePosition = "inside" | "before" | "after" | "root";

interface MoveTreeNodeInput {
  boxId: string;
  draggedType: TreeObjectType;
  draggedId: string;
  targetType?: TreeObjectType;
  targetId?: string;
  targetFolderId?: string | null;
  position: MovePosition;
  isAttachment?: boolean;
}

async function computePathCache(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "notes" | "files" | "skills" | "agents",
  objectId: string,
  targetFolderId: string | null
) {
  const { data: row, error } = await supabase
    .from(table)
    .select("slug")
    .eq("id", objectId)
    .single();
  if (error || !row) throw new Error("Object not found");
  if (!targetFolderId) return row.slug as string;
  const { data: folder, error: folderError } = await supabase
    .from("folders")
    .select("path_cache")
    .eq("id", targetFolderId)
    .single();
  if (folderError || !folder) throw new Error("Target folder not found");
  return `${folder.path_cache}/${row.slug}`;
}

export async function moveTreeNodeAction(input: MoveTreeNodeInput): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const { boxId, draggedType, draggedId, targetType, targetId, targetFolderId, position, isAttachment } = input;

    const { data: box } = await supabase.from("boxes").select("id, workspace_id").eq("id", boxId).single();
    if (!box || box.workspace_id !== workspaceId) return { ok: false, error: "Box not found" };

    let nextFolderId: string | null = null;
    if (position === "inside") {
      if (targetType !== "folder" || !targetId) return { ok: false, error: "Inside moves require a folder target" };
      nextFolderId = targetId;
    } else if (position === "root") {
      nextFolderId = null;
    } else {
      nextFolderId = targetFolderId ?? null;
    }

    // folder guardrails
    if (draggedType === "folder") {
      if (nextFolderId === draggedId) return { ok: false, error: "Cannot move a folder into itself" };
      if (nextFolderId) {
        const { data: targetFolder } = await supabase
          .from("folders")
          .select("path_cache, box_id")
          .eq("id", nextFolderId)
          .single();
        const { data: sourceFolder } = await supabase
          .from("folders")
          .select("path_cache, box_id")
          .eq("id", draggedId)
          .single();
        if (!targetFolder || !sourceFolder || targetFolder.box_id !== boxId || sourceFolder.box_id !== boxId) {
          return { ok: false, error: "Folder not found" };
        }
        if (targetFolder.path_cache.startsWith(`${sourceFolder.path_cache}/`)) {
          return { ok: false, error: "Cannot move a folder into its descendant" };
        }
      }
    }

    const sortValue = Date.now();
    if (draggedType === "folder") {
      const { data: folder } = await supabase
        .from("folders")
        .select("id, box_id, slug, path_cache")
        .eq("id", draggedId)
        .single();
      if (!folder || folder.box_id !== boxId) return { ok: false, error: "Folder not found" };

      let newPath = folder.slug;
      if (nextFolderId) {
        const { data: parent } = await supabase.from("folders").select("path_cache").eq("id", nextFolderId).single();
        if (!parent) return { ok: false, error: "Target folder not found" };
        newPath = `${parent.path_cache}/${folder.slug}`;
      }
      const oldPath = folder.path_cache;
      await supabase.from("folders").update({ parent_folder_id: nextFolderId, path_cache: newPath }).eq("id", draggedId);
      await supabase
        .from("workspace_objects")
        .update({ folder_id: nextFolderId, sort_order: sortValue })
        .eq("object_type", "folder")
        .eq("object_id", draggedId);

      // cascade descendant folder path caches
      const { data: descendants } = await supabase
        .from("folders")
        .select("id, path_cache")
        .like("path_cache", `${oldPath}/%`);
      for (const d of descendants ?? []) {
        const patched = d.path_cache.replace(oldPath, newPath);
        await supabase.from("folders").update({ path_cache: patched }).eq("id", d.id);
      }
      // cascade item path caches
      for (const table of ["notes", "files", "skills", "agents"] as const) {
        const { data: rows } = await supabase
          .from(table)
          .select("id, path_cache")
          .eq("box_id", boxId)
          .like("path_cache", `${oldPath}/%`);
        for (const row of rows ?? []) {
          await supabase.from(table).update({ path_cache: row.path_cache.replace(oldPath, newPath) }).eq("id", row.id);
        }
      }
    } else {
      if (isAttachment && (draggedType === "skill" || draggedType === "agent")) {
        await supabase
          .from("box_object_attachments")
          .update({ folder_id: nextFolderId, sort_order: sortValue })
          .eq("box_id", boxId)
          .eq("object_type", draggedType)
          .eq("object_id", draggedId);
      } else {
        const table = draggedType === "note" ? "notes" : draggedType === "file" ? "files" : draggedType === "skill" ? "skills" : "agents";
        const pathCache = await computePathCache(supabase, table, draggedId, nextFolderId);
        await supabase.from(table).update({ folder_id: nextFolderId, path_cache: pathCache }).eq("id", draggedId).eq("box_id", boxId);
        await supabase
          .from("workspace_objects")
          .update({ folder_id: nextFolderId, sort_order: sortValue })
          .eq("object_type", draggedType)
          .eq("object_id", draggedId);
      }
    }

    // lightweight sibling reorder support
    if (position === "before" || position === "after") {
      if (!targetType || !targetId) return { ok: false, error: "Missing target for reorder" };
      const targetSort = isAttachment
        ? (await supabase.from("box_object_attachments").select("sort_order").eq("box_id", boxId).eq("object_type", targetType).eq("object_id", targetId).maybeSingle()).data?.sort_order ?? sortValue
        : (await supabase.from("workspace_objects").select("sort_order").eq("object_type", targetType).eq("object_id", targetId).maybeSingle()).data?.sort_order ?? sortValue;
      const adjusted = position === "before" ? targetSort - 1 : targetSort + 1;
      if (isAttachment && (draggedType === "skill" || draggedType === "agent")) {
        await supabase
          .from("box_object_attachments")
          .update({ sort_order: adjusted })
          .eq("box_id", boxId)
          .eq("object_type", draggedType)
          .eq("object_id", draggedId);
      } else {
        await supabase
          .from("workspace_objects")
          .update({ sort_order: adjusted })
          .eq("object_type", draggedType)
          .eq("object_id", draggedId);
      }
    }

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to move tree node" };
  }
}
