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
import {
  compareSiblings,
  clampDropIndex,
  isFolderCycle,
} from "@/server/domain/tree_ordering";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Resolves the request context for an action.
 *
 * By default this enforces a write-capable role (member / admin / owner).
 * Viewers reaching a write-path action hit an early throw with a clear
 * message rather than a cryptic RLS error farther down the stack.
 *
 * Pass `{ requireWrite: false }` to opt out for read-only actions
 * (tree fetches, search, etc.). Read-only actions still require an
 * authenticated user and an active workspace.
 */
async function requireContext(options: { requireWrite?: boolean } = {}) {
  const { requireWrite = true } = options;
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  if (requireWrite && ctx.workspace.role === "viewer") {
    throw new Error("Viewers cannot perform write actions in this workspace.");
  }
  const supabase = await createClient();
  return {
    supabase,
    userId: ctx.user.id,
    workspaceId: ctx.workspace.id,
    role: ctx.workspace.role,
  };
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
    const { supabase } = await requireContext({ requireWrite: false });
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
    const { supabase, workspaceId } = await requireContext({ requireWrite: false });
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
    const { supabase, workspaceId } = await requireContext({ requireWrite: false });
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
  /** Folder id the dragged object should end up inside, or null for box root. */
  targetFolderId?: string | null;
  /** react-arborist drop index among siblings at the destination parent. */
  targetIndex?: number;
  /**
   * Legacy fields kept for backwards-compatibility with callers that still
   * use before/after/inside semantics. Prefer targetFolderId + targetIndex.
   */
  targetType?: TreeObjectType;
  targetId?: string;
  position?: MovePosition;
  isAttachment?: boolean;
}

/** A sibling entry at a given (box, parent folder) position. */
interface SiblingEntry {
  source: "workspace_object" | "box_attachment";
  objectType: TreeObjectType;
  objectId: string;
  sortOrder: number;
}

/**
 * Load every sibling at (boxId, folderId) — the union of native objects
 * (workspace_objects) and reusable attachments (box_object_attachments) —
 * and return them in the same order the tree sidebar displays:
 *   folders first, then everything else by sort_order (ties broken by id).
 *
 * The dragged node is excluded from the list so callers can insert it at
 * the desired target index deterministically.
 */
async function loadSiblings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boxId: string,
  folderId: string | null,
  exclude: { type: TreeObjectType; id: string; isAttachment: boolean }
): Promise<SiblingEntry[]> {
  const objectsQuery = supabase
    .from("workspace_objects")
    .select("object_type, object_id, sort_order")
    .eq("box_id", boxId)
    .neq("status", "trashed");
  if (folderId === null) {
    objectsQuery.is("folder_id", null);
  } else {
    objectsQuery.eq("folder_id", folderId);
  }
  const { data: objectRows } = await objectsQuery;

  const attachmentsQuery = supabase
    .from("box_object_attachments")
    .select("object_type, object_id, sort_order")
    .eq("box_id", boxId);
  if (folderId === null) {
    attachmentsQuery.is("folder_id", null);
  } else {
    attachmentsQuery.eq("folder_id", folderId);
  }
  const { data: attachmentRows } = await attachmentsQuery;

  const entries: SiblingEntry[] = [];
  for (const r of objectRows ?? []) {
    if (
      !exclude.isAttachment &&
      r.object_type === exclude.type &&
      r.object_id === exclude.id
    ) continue;
    entries.push({
      source: "workspace_object",
      objectType: r.object_type as TreeObjectType,
      objectId: r.object_id,
      sortOrder: Number(r.sort_order ?? 0),
    });
  }
  for (const r of attachmentRows ?? []) {
    if (
      exclude.isAttachment &&
      r.object_type === exclude.type &&
      r.object_id === exclude.id
    ) continue;
    entries.push({
      source: "box_attachment",
      objectType: r.object_type as TreeObjectType,
      objectId: r.object_id,
      sortOrder: Number(r.sort_order ?? 0),
    });
  }

  // Use the shared comparator so the server and the client tree agree on
  // sibling order. See src/server/domain/tree_ordering.ts.
  entries.sort(compareSiblings);
  return entries;
}

/**
 * Re-spread sort_order across every sibling in `order` using a gapped
 * scheme so future single-item reorders don't need to rewrite every row.
 *
 * We use (i + 1) * 1000 as the ordinal. That leaves 999 slots between any
 * two neighbours for future midpoint inserts if we ever want to avoid
 * full re-spreading on every reorder.
 */
async function writeSiblingOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boxId: string,
  order: SiblingEntry[]
): Promise<void> {
  for (let i = 0; i < order.length; i++) {
    const sort = (i + 1) * 1000;
    const entry = order[i];
    if (entry.source === "workspace_object") {
      await supabase
        .from("workspace_objects")
        .update({ sort_order: sort })
        .eq("object_type", entry.objectType)
        .eq("object_id", entry.objectId);
    } else {
      await supabase
        .from("box_object_attachments")
        .update({ sort_order: sort })
        .eq("box_id", boxId)
        .eq("object_type", entry.objectType)
        .eq("object_id", entry.objectId);
    }
  }
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
  // Every tree mutation is a change set. Opened before the work starts so
  // the state transition (move, reorder, cascade path rewrites) is
  // recorded as one grouped operation restorable with one click. The
  // change set is opened lazily after we confirm ownership so invalid
  // requests don't leak empty open change sets into history.
  let changeSetId: string | null = null;
  let changeSetSupabase: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const { boxId, draggedType, draggedId, isAttachment = false } = input;

    const { data: box } = await supabase.from("boxes").select("id, workspace_id").eq("id", boxId).single();
    if (!box || box.workspace_id !== workspaceId) return { ok: false, error: "Box not found" };

    // Capture the dragged node's pre-move state so the structural event
    // carries a complete before-snapshot. This is what the restore
    // planner will replay LIFO. For attachments the pre-state lives in
    // box_object_attachments; for native objects in workspace_objects.
    const preStateRow = isAttachment && (draggedType === "skill" || draggedType === "agent")
      ? (await supabase
          .from("box_object_attachments")
          .select("box_id, folder_id, sort_order, object_type")
          .eq("box_id", boxId)
          .eq("object_type", draggedType)
          .eq("object_id", draggedId)
          .maybeSingle()).data
      : (await supabase
          .from("workspace_objects")
          .select("box_id, folder_id, sort_order, object_type")
          .eq("object_type", draggedType)
          .eq("object_id", draggedId)
          .maybeSingle()).data;

    // For folder moves we also capture the folders row so parent_folder_id
    // and path_cache can be restored on rollback.
    const preFolderRow = draggedType === "folder"
      ? (await supabase
          .from("folders")
          .select("parent_folder_id, path_cache")
          .eq("id", draggedId)
          .maybeSingle()).data
      : null;

    const { openChangeSet } = await import("@/server/services/change_set_service");
    const cs = await openChangeSet(supabase, {
      workspace_id: workspaceId,
      origin: "structural_move",
      actor_type: "user",
      actor_id: userId,
      summary: `Move ${draggedType} ${draggedId.slice(0, 8)} in box ${boxId.slice(0, 8)}`,
      metadata: { box_id: boxId, dragged_type: draggedType, is_attachment: isAttachment },
    });
    changeSetId = cs.id;
    changeSetSupabase = supabase;

    // Resolve destination folder. Prefer explicit targetFolderId. Fall back
    // to the legacy position/targetId contract so older callers keep working.
    let nextFolderId: string | null;
    if (input.targetFolderId !== undefined) {
      nextFolderId = input.targetFolderId;
    } else if (input.position === "inside") {
      if (input.targetType !== "folder" || !input.targetId) {
        return { ok: false, error: "Inside moves require a folder target" };
      }
      nextFolderId = input.targetId;
    } else if (input.position === "root") {
      nextFolderId = null;
    } else {
      nextFolderId = null;
    }

    // Folder guardrails — a folder cannot be moved into itself or any of
    // its descendants. We check by looking at the target's path_cache
    // starts with the source folder's path_cache.
    if (draggedType === "folder") {
      if (nextFolderId === draggedId) {
        return { ok: false, error: "Cannot move a folder into itself" };
      }
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
        if (
          !targetFolder || !sourceFolder ||
          targetFolder.box_id !== boxId || sourceFolder.box_id !== boxId
        ) {
          return { ok: false, error: "Folder not found" };
        }
        if (isFolderCycle(sourceFolder.path_cache, targetFolder.path_cache)) {
          return { ok: false, error: "Cannot move a folder into its descendant" };
        }
      }
    }

    // ── 1. Update dragged node placement (folder_id / path_cache) ──────────
    if (draggedType === "folder") {
      const { data: folder } = await supabase
        .from("folders")
        .select("id, box_id, slug, path_cache")
        .eq("id", draggedId)
        .single();
      if (!folder || folder.box_id !== boxId) {
        return { ok: false, error: "Folder not found" };
      }

      let newPath = folder.slug;
      if (nextFolderId) {
        const { data: parent } = await supabase
          .from("folders")
          .select("path_cache")
          .eq("id", nextFolderId)
          .single();
        if (!parent) return { ok: false, error: "Target folder not found" };
        newPath = `${parent.path_cache}/${folder.slug}`;
      }
      const oldPath = folder.path_cache;

      await supabase
        .from("folders")
        .update({ parent_folder_id: nextFolderId, path_cache: newPath })
        .eq("id", draggedId);
      await supabase
        .from("workspace_objects")
        .update({ folder_id: nextFolderId })
        .eq("object_type", "folder")
        .eq("object_id", draggedId);

      // Cascade descendant folder paths.
      if (oldPath !== newPath) {
        const { data: descendants } = await supabase
          .from("folders")
          .select("id, path_cache")
          .like("path_cache", `${oldPath}/%`);
        for (const d of descendants ?? []) {
          const patched = `${newPath}${d.path_cache.slice(oldPath.length)}`;
          await supabase.from("folders").update({ path_cache: patched }).eq("id", d.id);
        }
        // Cascade descendant leaf paths in notes/files/skills/agents.
        for (const table of ["notes", "files", "skills", "agents"] as const) {
          const { data: rows } = await supabase
            .from(table)
            .select("id, path_cache")
            .eq("box_id", boxId)
            .like("path_cache", `${oldPath}/%`);
          for (const row of rows ?? []) {
            const patched = `${newPath}${row.path_cache.slice(oldPath.length)}`;
            await supabase.from(table).update({ path_cache: patched }).eq("id", row.id);
          }
        }
      }
    } else if (isAttachment && (draggedType === "skill" || draggedType === "agent")) {
      // Reusable skill/agent attached into this box by reference. Placement
      // lives in box_object_attachments only.
      await supabase
        .from("box_object_attachments")
        .update({ folder_id: nextFolderId })
        .eq("box_id", boxId)
        .eq("object_type", draggedType)
        .eq("object_id", draggedId);
    } else {
      const table =
        draggedType === "note" ? "notes" :
        draggedType === "file" ? "files" :
        draggedType === "skill" ? "skills" : "agents";
      const pathCache = await computePathCache(supabase, table, draggedId, nextFolderId);
      await supabase
        .from(table)
        .update({ folder_id: nextFolderId, path_cache: pathCache })
        .eq("id", draggedId)
        .eq("box_id", boxId);
      await supabase
        .from("workspace_objects")
        .update({ folder_id: nextFolderId })
        .eq("object_type", draggedType)
        .eq("object_id", draggedId);
    }

    // ── 2. Re-spread sibling sort_orders at the destination parent ─────────
    //
    // This is what makes reorder actually persist. We load every sibling
    // at (boxId, nextFolderId) in the display order the tree renders,
    // splice the dragged node into the requested position, and re-assign
    // all sort_orders with a gapped scheme. That guarantees the drop lands
    // exactly where the user released regardless of prior sort_order state.
    const siblings = await loadSiblings(supabase, boxId, nextFolderId, {
      type: draggedType,
      id: draggedId,
      isAttachment,
    });

    const draggedEntry: SiblingEntry = {
      source: (isAttachment && (draggedType === "skill" || draggedType === "agent"))
        ? "box_attachment"
        : "workspace_object",
      objectType: draggedType,
      objectId: draggedId,
      sortOrder: 0, // overwritten by writeSiblingOrder
    };

    // Clamp the drop index against the folder-first invariant. The shared
    // helper keeps server and client behaviour in lock-step.
    const targetIndex = clampDropIndex(
      siblings,
      draggedType,
      input.targetIndex ?? siblings.length
    );

    const ordered = [
      ...siblings.slice(0, targetIndex),
      draggedEntry,
      ...siblings.slice(targetIndex),
    ];
    await writeSiblingOrder(supabase, boxId, ordered);

    // Record the structural event on the change set we opened above.
    // The before_state is the pre-move placement; after_state is where
    // the object ended up. This is enough for the restore service to
    // rebuild the prior topology.
    const { recordStructuralEvent, commitChangeSet } = await import("@/server/services/change_set_service");
    const postStateRow = isAttachment && (draggedType === "skill" || draggedType === "agent")
      ? (await supabase
          .from("box_object_attachments")
          .select("box_id, folder_id, sort_order, object_type")
          .eq("box_id", boxId)
          .eq("object_type", draggedType)
          .eq("object_id", draggedId)
          .maybeSingle()).data
      : (await supabase
          .from("workspace_objects")
          .select("box_id, folder_id, sort_order, object_type")
          .eq("object_type", draggedType)
          .eq("object_id", draggedId)
          .maybeSingle()).data;
    const postFolderRow = draggedType === "folder"
      ? (await supabase
          .from("folders")
          .select("parent_folder_id, path_cache")
          .eq("id", draggedId)
          .maybeSingle()).data
      : null;

    await recordStructuralEvent(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      box_id: boxId,
      event_type: "move",
      object_type: isAttachment ? "box_object_attachment" : draggedType,
      object_id: draggedId,
      before_state: {
        ...(preStateRow ?? {}),
        ...(preFolderRow ? {
          parent_folder_id: preFolderRow.parent_folder_id,
          path_cache: preFolderRow.path_cache,
        } : {}),
      },
      after_state: {
        ...(postStateRow ?? {}),
        ...(postFolderRow ? {
          parent_folder_id: postFolderRow.parent_folder_id,
          path_cache: postFolderRow.path_cache,
        } : {}),
      },
    });
    await commitChangeSet(supabase, cs.id);

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    // Abort the change set if it was opened so we don't leave dangling
    // open rows. The abort call is idempotent and safe in a finally.
    if (changeSetId && changeSetSupabase) {
      const { abortChangeSet } = await import("@/server/services/change_set_service");
      await abortChangeSet(
        changeSetSupabase,
        changeSetId,
        err instanceof Error ? err.message : "move failed"
      ).catch(() => {});
    }
    return { ok: false, error: err instanceof Error ? err.message : "Failed to move tree node" };
  }
}
