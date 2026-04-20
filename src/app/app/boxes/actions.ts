"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createBox, updateBox } from "@/server/services/box_service";
import { createFolder, renameFolder } from "@/server/services/folder_service";
// createNote + createNoteOnBranch are imported lazily in the note
// create action below so the top of the module stays bundler-light.
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
    // Surface the active draft branch so write paths can route new
    // rows to `createXOnBranch` variants when set. Null means the
    // user is editing main.
    activeBranchId: ctx.activeBranchId,
  };
}

// ─── Box actions ──────────────────────────────────────────────────────────────

export async function createBoxAction(
  name: string,
  description?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();

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

    // Branch-local box creation: stamp branch_id so the box is
    // invisible to main readers until promote. Mirrors the pattern
    // used by createFolderAction / createFileOnBranch. Discard
    // hard-deletes via `.delete().eq("branch_id", branchId)` in
    // discardBranchAction.
    if (activeBranchId) {
      await supabase
        .from("boxes")
        .update({ branch_id: activeBranchId })
        .eq("id", box.id);
      box.branch_id = activeBranchId;
    }

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
  changes: {
    name?: string;
    description?: string | null;
    agent_instructions?: string | null;
  }
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();

    // Branch-aware update: when the user is editing on a draft branch
    // AND the target box is a main row, route the write to the
    // `box_branch_metadata_overlay`. Branch-local boxes (branch_id
    // matches the active branch) are updated in place because the
    // whole row belongs to the branch. See v1.9 design note in
    // docs/branch_local_structural_creation_v1.md.
    if (activeBranchId) {
      const { data: boxRow } = await supabase
        .from("boxes")
        .select("workspace_id, branch_id")
        .eq("id", boxId)
        .maybeSingle();
      if (!boxRow || boxRow.workspace_id !== workspaceId) {
        return { ok: false, error: "Box not found" };
      }
      if (boxRow.branch_id !== activeBranchId) {
        const { upsertBoxMetadataOverlay } = await import(
          "@/server/services/box_branch_metadata_service"
        );
        await upsertBoxMetadataOverlay(supabase, {
          branchId: activeBranchId,
          boxId,
          name: changes.name !== undefined ? changes.name : undefined,
          description: changes.description !== undefined ? changes.description : undefined,
        });
        // agent_instructions is workspace configuration (not branchable
        // content), so write it straight to main even when a branch is
        // active. This matches the behaviour of workspace-level rules.
        if (changes.agent_instructions !== undefined) {
          await updateBox(supabase, userId, boxId, workspaceId, {
            agent_instructions: changes.agent_instructions,
          });
        }
        revalidatePath(`/app/boxes/${boxId}`);
        revalidatePath("/app");
        return { ok: true, data: undefined };
      }
    }

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
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
    const folder = await createFolder(supabase, userId, workspaceId, {
      boxId,
      name: name.trim(),
      parentFolderId: parentFolderId ?? null,
    });

    // Branch-local folder creation: stamp branch_id so the folder
    // is invisible to main readers until promote. Same pattern as
    // createFileOnBranch. The canonical `folders` row still carries
    // every other field (parent, path_cache, slug) so membership
    // derivation continues to work.
    if (activeBranchId) {
      await supabase
        .from("folders")
        .update({ branch_id: activeBranchId })
        .eq("id", folder.id);
      folder.branch_id = activeBranchId;
    }

    // Record the creation in a change set so the folder is restorable.
    // folder_create events are the input the restore executor needs to
    // safely undo a folder creation — inverse is a soft-trash of the
    // folder (preserving content for second-chance recovery).
    const { openChangeSet, commitChangeSet, recordChangeSetItem, recordStructuralEvent } =
      await import("@/server/services/change_set_service");
    const cs = await openChangeSet(supabase, {
      workspace_id: workspaceId,
      origin: "manual_edit",
      actor_type: "user",
      actor_id: userId,
      summary: `Create folder ${folder.name}`,
      metadata: { box_id: boxId, folder_id: folder.id },
    });
    await recordChangeSetItem(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      operation: "create",
      object_type: "folder",
      object_id: folder.id,
      after_snapshot: {
        name: folder.name,
        slug: folder.slug,
        path_cache: folder.path_cache,
        parent_folder_id: folder.parent_folder_id,
        box_id: folder.box_id,
        status: folder.status,
      },
    });
    await recordStructuralEvent(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      box_id: folder.box_id ?? null,
      event_type: "folder_create",
      object_type: "folder",
      object_id: folder.id,
      before_state: {},
      after_state: {
        name: folder.name,
        slug: folder.slug,
        path_cache: folder.path_cache,
        parent_folder_id: folder.parent_folder_id,
        box_id: folder.box_id,
        status: folder.status,
      },
    });
    await commitChangeSet(supabase, cs.id);

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
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
    const trimmed = newName.trim();

    // When a branch is active and the folder is a main row, record
    // the rename as an override on `folder_branch_overrides` rather
    // than mutating the canonical folder. Branch-created folders
    // (branch_id set) are updated directly since there is no main
    // counterpart to protect. See
    // docs/branch_local_structural_creation_v1.md.
    if (activeBranchId) {
      const { data: folder } = await supabase
        .from("folders")
        .select("id, branch_id, path_cache, slug")
        .eq("id", folderId)
        .maybeSingle();
      if (!folder) return { ok: false, error: "Folder not found" };

      if (folder.branch_id === null) {
        const { slugify } = await import("@/lib/slugify");
        const newSlug = slugify(trimmed);
        const oldPathSegments = (folder.path_cache ?? "").split("/");
        oldPathSegments[oldPathSegments.length - 1] = newSlug;
        const newPathCache = oldPathSegments.join("/");

        const { upsertFolderOverride } = await import(
          "@/server/services/folder_branch_service"
        );
        await upsertFolderOverride(supabase, {
          branchId: activeBranchId,
          folderId,
          actorId: userId,
          patch: { name: trimmed, path_cache: newPathCache },
        });
        revalidatePath(`/app/boxes/${boxId}`);
        return { ok: true, data: undefined };
      }
    }

    await renameFolder(supabase, userId, workspaceId, folderId, trimmed);
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
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();

    const noteLimit = await checkNoteLimit(supabase, workspaceId);
    if (!noteLimit.allowed) {
      return {
        ok: false,
        error: "Note limit reached. Upgrade to Pro for unlimited notes.",
      };
    }

    // Route to the branch-local create variant when a draft branch is
    // active. The note lands with `branch_id` stamped, invisible to
    // main readers until promote. Main readers (box pages, search,
    // listNotesByBox without branchId) filter it out.
    const { createNote, createNoteOnBranch } = await import(
      "@/server/services/note_service"
    );
    const createParams = {
      boxId,
      folderId: folderId ?? null,
      title: title.trim(),
      kind,
      markdownContent: markdownContent ?? "",
    };
    const note = activeBranchId
      ? await createNoteOnBranch(supabase, userId, workspaceId, activeBranchId, createParams)
      : await createNote(supabase, userId, workspaceId, createParams);
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
    const { supabase, workspaceId, activeBranchId } = await requireContext({ requireWrite: false });
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

    // Thread the active branch so the tree shows the caller's own
    // branch-local folders/notes/files overlaid on main.
    const [folders, notes, files, localSkills, localAgents, attachments] = await Promise.all([
      listFoldersByBox(supabase, boxId, { branchId: activeBranchId }),
      listNotesByBox(supabase, boxId, { branchId: activeBranchId }),
      listFilesByBox(supabase, boxId, { branchId: activeBranchId }),
      listSkillsByBox(supabase, boxId, { includeArchived: true }),
      listAgentsByBox(supabase, boxId, { includeArchived: true }),
      listAttachmentsForBox(supabase, boxId, { branchId: activeBranchId }),
    ]);
    const { data: registryRows } = await supabase
      .from("workspace_objects")
      .select("id, object_type, object_id, sort_order")
      .eq("box_id", boxId);
    // Apply per-branch placement overlay so the sidebar tree's
    // sort_order map agrees with `loadSiblings` while a branch is
    // active. Without this the tree would render canonical sort_order
    // and a freshly reordered branch row would visually snap back.
    let overlaidRegistry = (registryRows ?? []) as Array<{
      id: string;
      object_type: string;
      object_id: string;
      sort_order: number | null;
    }>;
    if (activeBranchId) {
      const { listPlacementOverridesForBox } = await import(
        "@/server/services/placement_branch_service"
      );
      const ovs = await listPlacementOverridesForBox(
        supabase,
        activeBranchId,
        boxId
      );
      const byTarget = new Map(
        ovs
          .filter((o) => o.target_type === "workspace_object")
          .map((o) => [o.target_id, o])
      );
      overlaidRegistry = overlaidRegistry.map((row) => {
        const ov = byTarget.get(row.id);
        if (!ov) return row;
        return { ...row, sort_order: ov.sort_order ?? row.sort_order };
      });
    }
    const sortOrder = new Map<string, number>();
    for (const row of overlaidRegistry) {
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
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
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

    // Return existing attachment silently if already present in the
    // caller's branch context. Main-only attach paths use the main
    // partition (branch_id IS NULL); a branch caller considers main
    // + matching-branch rows.
    const alreadyAttached = await isObjectAttachedToBox(
      supabase, boxId, "skill", skillId, { branchId: activeBranchId }
    );
    if (alreadyAttached) {
      const existing = await listAttachmentsForBox(supabase, boxId, { branchId: activeBranchId });
      const row = existing.find((a) => a.object_type === "skill" && a.object_id === skillId);
      return { ok: true, data: { id: row?.id ?? skillId } };
    }

    // Branch-local attach: stamp branch_id on the insert so the row
    // stays invisible to main readers until promote. Discard hard-
    // deletes via `.delete().eq("branch_id", branchId)` in
    // discardBranchAction.
    const attachment = await createAttachment(supabase, {
      workspace_id: workspaceId,
      box_id: boxId,
      folder_id: folderId ?? null,
      object_type: "skill",
      object_id: skillId,
      attached_by: userId,
      branch_id: activeBranchId ?? null,
    });

    // Record the attachment as a structural event on a fresh change
    // set so it can be reversed later. before_state = {} because an
    // attach creates the attachment row; inverse is a detach that
    // deletes by (box, object_type, object_id).
    const { openChangeSet, commitChangeSet, recordStructuralEvent, recordChangeSetItem } =
      await import("@/server/services/change_set_service");
    const cs = await openChangeSet(supabase, {
      workspace_id: workspaceId,
      origin: "structural_move",
      actor_type: "user",
      actor_id: userId,
      summary: `Attach skill ${skillId.slice(0, 8)} to box ${boxId.slice(0, 8)}`,
      metadata: { box_id: boxId, object_type: "skill", object_id: skillId },
    });
    await recordChangeSetItem(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      operation: "attach",
      object_type: "box_object_attachment",
      object_id: attachment.id,
      after_snapshot: { box_id: boxId, object_type: "skill", object_id: skillId, folder_id: folderId ?? null },
    });
    await recordStructuralEvent(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      box_id: boxId,
      event_type: "attach",
      object_type: "box_object_attachment",
      object_id: attachment.id,
      before_state: {},
      after_state: {
        box_id: boxId,
        object_type: "skill",
        object_id: skillId,
        folder_id: folderId ?? null,
        attached_by: userId,
      },
    });
    await commitChangeSet(supabase, cs.id);

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
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
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

    const alreadyAttached = await isObjectAttachedToBox(
      supabase, boxId, "agent", agentId, { branchId: activeBranchId }
    );
    if (alreadyAttached) {
      const existing = await listAttachmentsForBox(supabase, boxId, { branchId: activeBranchId });
      const row = existing.find((a) => a.object_type === "agent" && a.object_id === agentId);
      return { ok: true, data: { id: row?.id ?? agentId } };
    }

    // Branch-local attach — stamp branch_id; see attachSkillToBoxAction.
    const attachment = await createAttachment(supabase, {
      workspace_id: workspaceId,
      box_id: boxId,
      folder_id: folderId ?? null,
      object_type: "agent",
      object_id: agentId,
      attached_by: userId,
      branch_id: activeBranchId ?? null,
    });

    const { openChangeSet, commitChangeSet, recordStructuralEvent, recordChangeSetItem } =
      await import("@/server/services/change_set_service");
    const cs = await openChangeSet(supabase, {
      workspace_id: workspaceId,
      origin: "structural_move",
      actor_type: "user",
      actor_id: userId,
      summary: `Attach agent ${agentId.slice(0, 8)} to box ${boxId.slice(0, 8)}`,
      metadata: { box_id: boxId, object_type: "agent", object_id: agentId },
    });
    await recordChangeSetItem(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      operation: "attach",
      object_type: "box_object_attachment",
      object_id: attachment.id,
      after_snapshot: { box_id: boxId, object_type: "agent", object_id: agentId, folder_id: folderId ?? null },
    });
    await recordStructuralEvent(supabase, {
      change_set_id: cs.id,
      workspace_id: workspaceId,
      box_id: boxId,
      event_type: "attach",
      object_type: "box_object_attachment",
      object_id: attachment.id,
      before_state: {},
      after_state: {
        box_id: boxId,
        object_type: "agent",
        object_id: agentId,
        folder_id: folderId ?? null,
        attached_by: userId,
      },
    });
    await commitChangeSet(supabase, cs.id);

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
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
    const { getBoxById } = await import("@/server/repositories/box_repository");
    const { deleteAttachmentForObject, listAttachmentsForBox, deleteAttachment } = await import("@/server/repositories/box_object_attachment_repository");

    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== workspaceId) return { ok: false, error: "Box not found" };

    // Capture the attachment row before we delete it. before_state on
    // the structural event carries everything the inverse needs to
    // re-insert: box_id, folder_id, sort_order, attached_by.
    const existing = await listAttachmentsForBox(supabase, boxId, { branchId: activeBranchId });
    const priorRow = existing.find(
      (a) => a.object_type === objectType && a.object_id === objectId
    );

    // Branch-aware detach:
    //  * branch-local attachment (branch_id === activeBranchId) → hard
    //    delete in place; the row never reached main.
    //  * main attachment (branch_id === null) on a branch → record a
    //    pending detach op so main survives until promote.
    //  * main attachment without an active branch → continue the
    //    existing change_set-wrapped hard delete.
    if (activeBranchId && priorRow) {
      if (priorRow.branch_id === activeBranchId) {
        await deleteAttachment(supabase, priorRow.id);
      } else if ((priorRow.branch_id ?? null) === null) {
        const { recordPendingOp } = await import(
          "@/server/services/pending_op_service"
        );
        await recordPendingOp(supabase, {
          branchId: activeBranchId,
          actorId: userId,
          opType: "detach",
          objectType: "box_object_attachment",
          objectId: priorRow.id,
        });
      } else {
        return { ok: false, error: "Attachment belongs to another branch" };
      }
      revalidatePath(`/app/boxes/${boxId}`);
      return { ok: true, data: undefined };
    }

    await deleteAttachmentForObject(supabase, boxId, objectType, objectId);

    if (priorRow) {
      const { openChangeSet, commitChangeSet, recordStructuralEvent, recordChangeSetItem } =
        await import("@/server/services/change_set_service");
      const cs = await openChangeSet(supabase, {
        workspace_id: workspaceId,
        origin: "structural_move",
        actor_type: "user",
        actor_id: userId,
        summary: `Detach ${objectType} ${objectId.slice(0, 8)} from box ${boxId.slice(0, 8)}`,
        metadata: { box_id: boxId, object_type: objectType, object_id: objectId },
      });
      await recordChangeSetItem(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        operation: "detach",
        object_type: "box_object_attachment",
        object_id: priorRow.id,
        before_snapshot: {
          box_id: priorRow.box_id,
          folder_id: priorRow.folder_id,
          object_type: priorRow.object_type,
          object_id: priorRow.object_id,
          sort_order: priorRow.sort_order,
        },
      });
      await recordStructuralEvent(supabase, {
        change_set_id: cs.id,
        workspace_id: workspaceId,
        box_id: boxId,
        event_type: "detach",
        object_type: "box_object_attachment",
        object_id: priorRow.id,
        before_state: {
          box_id: priorRow.box_id,
          folder_id: priorRow.folder_id,
          object_type: priorRow.object_type,
          object_id: priorRow.object_id,
          sort_order: priorRow.sort_order,
          attached_by: priorRow.attached_by,
        },
        after_state: {},
      });
      await commitChangeSet(supabase, cs.id);
    }

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
  /** PK of the workspace_objects / box_object_attachments row.
   *  Required so branch-aware writes can address placement overrides
   *  by row id instead of re-deriving the lookup every tick. */
  targetId: string;
  sortOrder: number;
  /** Folder placement (null = root). Reflects the overlay when a
   *  branch is active and an override exists, otherwise the canonical
   *  row's folder_id. */
  folderId: string | null;
}

/**
 * Load every sibling at (boxId, folderId) — the union of native objects
 * (workspace_objects) and reusable attachments (box_object_attachments) —
 * and return them in the same order the tree sidebar displays:
 *   folders first, then everything else by sort_order (ties broken by id).
 *
 * The dragged node is excluded from the list so callers can insert it at
 * the desired target index deterministically.
 *
 * Branch-aware: when `branchId` is set, every row is passed through
 * `applyPlacementOverrideToRow` before the (folderId, sort_order)
 * filter / comparator runs. That makes the comparator see the
 * overlaid state, so prior branch-local reorders and moves stack
 * correctly when the user drags again on the same branch. Main
 * readers (no branchId) keep the original direct-filter behaviour.
 */
async function loadSiblings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boxId: string,
  folderId: string | null,
  exclude: { type: TreeObjectType; id: string; isAttachment: boolean },
  branchId: string | null = null
): Promise<SiblingEntry[]> {
  // When on a branch, overlay the full box (not just the folder) and
  // filter by overlaid folder_id — otherwise a row moved into the
  // target folder via overlay would be missing from the sibling list.
  const objectsQuery = supabase
    .from("workspace_objects")
    .select("id, object_type, object_id, sort_order, folder_id")
    .eq("box_id", boxId)
    .neq("status", "trashed");
  if (!branchId) {
    if (folderId === null) objectsQuery.is("folder_id", null);
    else objectsQuery.eq("folder_id", folderId);
  }
  const { data: objectRows } = await objectsQuery;

  const attachmentsQuery = supabase
    .from("box_object_attachments")
    .select("id, object_type, object_id, sort_order, folder_id")
    .eq("box_id", boxId);
  if (!branchId) {
    if (folderId === null) attachmentsQuery.is("folder_id", null);
    else attachmentsQuery.eq("folder_id", folderId);
  }
  const { data: attachmentRows } = await attachmentsQuery;

  // Pull every placement override for the box once so we don't
  // round-trip per row. Keyed by `${target_type}:${target_id}`.
  const { applyPlacementOverrideToRow, listPlacementOverridesForBox } =
    await import("@/server/services/placement_branch_service");
  const overridesByKey = new Map<
    string,
    Awaited<ReturnType<typeof listPlacementOverridesForBox>>[number]
  >();
  if (branchId) {
    const ovs = await listPlacementOverridesForBox(supabase, branchId, boxId);
    for (const ov of ovs) {
      overridesByKey.set(`${ov.target_type}:${ov.target_id}`, ov);
    }
  }

  interface RawRow {
    id: string;
    object_type: string;
    object_id: string;
    sort_order: number | null;
    folder_id: string | null;
  }

  const entries: SiblingEntry[] = [];
  for (const raw of (objectRows ?? []) as RawRow[]) {
    const overlaid = applyPlacementOverrideToRow(
      { ...raw },
      overridesByKey.get(`workspace_object:${raw.id}`)
    );
    const effectiveFolderId = overlaid.folder_id ?? null;
    if (effectiveFolderId !== folderId) continue;
    if (
      !exclude.isAttachment &&
      raw.object_type === exclude.type &&
      raw.object_id === exclude.id
    ) continue;
    entries.push({
      source: "workspace_object",
      objectType: raw.object_type as TreeObjectType,
      objectId: raw.object_id,
      targetId: raw.id,
      sortOrder: Number(overlaid.sort_order ?? 0),
      folderId: effectiveFolderId,
    });
  }
  for (const raw of (attachmentRows ?? []) as RawRow[]) {
    const overlaid = applyPlacementOverrideToRow(
      { ...raw },
      overridesByKey.get(`box_object_attachment:${raw.id}`)
    );
    const effectiveFolderId = overlaid.folder_id ?? null;
    if (effectiveFolderId !== folderId) continue;
    if (
      exclude.isAttachment &&
      raw.object_type === exclude.type &&
      raw.object_id === exclude.id
    ) continue;
    entries.push({
      source: "box_attachment",
      objectType: raw.object_type as TreeObjectType,
      objectId: raw.object_id,
      targetId: raw.id,
      sortOrder: Number(overlaid.sort_order ?? 0),
      folderId: effectiveFolderId,
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
 *
 * Branch-aware: when a branch is active, every write routes through
 * `upsertPlacementOverride` so the canonical row stays untouched.
 * Without a branch we fall back to the direct update on
 * `workspace_objects` / `box_object_attachments`.
 */
async function writeSiblingOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  boxId: string,
  order: SiblingEntry[],
  opts: { branchId?: string | null; actorId?: string } = {}
): Promise<void> {
  const branchId = opts.branchId ?? null;
  if (branchId) {
    const { upsertPlacementOverride } = await import(
      "@/server/services/placement_branch_service"
    );
    for (let i = 0; i < order.length; i++) {
      const sort = (i + 1) * 1000;
      const entry = order[i];
      await upsertPlacementOverride(supabase, {
        branchId,
        actorId: opts.actorId ?? "",
        targetType: entry.source === "workspace_object"
          ? "workspace_object"
          : "box_object_attachment",
        targetId: entry.targetId,
        objectType: entry.objectType,
        objectId: entry.objectId,
        boxId,
        patch: { sortOrder: sort },
      });
    }
    return;
  }

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
    const { supabase, userId, workspaceId, activeBranchId } = await requireContext();
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
        .select("id, box_id, slug, path_cache, branch_id")
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

      // Branch-routed move: when a branch is active and the folder
      // is a main row, record an overlay rather than mutating the
      // canonical folder. Descendant path cascades are NOT written
      // to the overlay — promote re-derives the authoritative paths
      // from the patched parent.
      if (activeBranchId && folder.branch_id === null) {
        const { upsertFolderOverride } = await import(
          "@/server/services/folder_branch_service"
        );
        await upsertFolderOverride(supabase, {
          branchId: activeBranchId,
          folderId: draggedId,
          actorId: userId,
          patch: { parent_folder_id: nextFolderId, path_cache: newPath },
        });
      } else {
        await supabase
          .from("folders")
          .update({ parent_folder_id: nextFolderId, path_cache: newPath })
          .eq("id", draggedId);
        await supabase
          .from("workspace_objects")
          .update({ folder_id: nextFolderId })
          .eq("object_type", "folder")
          .eq("object_id", draggedId);
      }

      // Cascade descendant folder paths. For every descendant we
      // rewrite, record a `path_cascade` structural event on the
      // open change set so a later restore can rebuild the exact
      // prior topology, not just the dragged folder's row.
      //
      // This is bounded by the subtree size — typical folders have
      // far fewer descendants than the per-request cost justifies.
      const { recordStructuralEvent: recordCascadeEvent } = await import(
        "@/server/services/change_set_service"
      );

      // Skip the cascade when the move is overlay-recorded — promote
      // re-derives the authoritative path_cache from the patched
      // parent, so the branch overlay doesn't need per-descendant
      // intent. See docs/branch_local_structural_creation_v1.md.
      const isOverlayMove = !!activeBranchId && folder.branch_id === null;

      if (oldPath !== newPath && !isOverlayMove) {
        const { data: descendants } = await supabase
          .from("folders")
          .select("id, path_cache")
          .like("path_cache", `${oldPath}/%`);
        for (const d of descendants ?? []) {
          const patched = `${newPath}${d.path_cache.slice(oldPath.length)}`;
          await supabase.from("folders").update({ path_cache: patched }).eq("id", d.id);
          await recordCascadeEvent(supabase, {
            change_set_id: cs.id,
            workspace_id: workspaceId,
            box_id: boxId,
            event_type: "path_cascade",
            object_type: "folder",
            object_id: d.id,
            before_state: { path_cache: d.path_cache },
            after_state: { path_cache: patched },
          });
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
            await recordCascadeEvent(supabase, {
              change_set_id: cs.id,
              workspace_id: workspaceId,
              box_id: boxId,
              event_type: "path_cascade",
              // object_type on structural_events is constrained to the
              // leaf object types we version; notes are included.
              object_type: table === "notes" ? "note"
                : table === "files" ? "file"
                : table === "skills" ? "skill" : "agent",
              object_id: row.id,
              before_state: { path_cache: row.path_cache },
              after_state: { path_cache: patched },
            });
          }
        }
      }
    } else if (isAttachment && (draggedType === "skill" || draggedType === "agent")) {
      // Reusable skill/agent attached into this box by reference. Placement
      // lives in box_object_attachments only.
      if (activeBranchId) {
        // Branch-routed: record the folder_id move as an overlay
        // row against the attachment PK. Main untouched until
        // promote. See `placement_branch_service.ts`.
        const { data: att } = await supabase
          .from("box_object_attachments")
          .select("id")
          .eq("box_id", boxId)
          .eq("object_type", draggedType)
          .eq("object_id", draggedId)
          .maybeSingle();
        if (att?.id) {
          const { upsertPlacementOverride } = await import(
            "@/server/services/placement_branch_service"
          );
          await upsertPlacementOverride(supabase, {
            branchId: activeBranchId,
            actorId: userId,
            targetType: "box_object_attachment",
            targetId: att.id,
            objectType: draggedType,
            objectId: draggedId,
            boxId,
            patch: {
              folderId: nextFolderId,
              folderIdOverridden: true,
            },
          });
        }
      } else {
        await supabase
          .from("box_object_attachments")
          .update({ folder_id: nextFolderId })
          .eq("box_id", boxId)
          .eq("object_type", draggedType)
          .eq("object_id", draggedId);
      }
    } else {
      const table =
        draggedType === "note" ? "notes" :
        draggedType === "file" ? "files" :
        draggedType === "skill" ? "skills" : "agents";

      if (activeBranchId) {
        // Branch-routed cross-folder move for native objects.
        // Folder intent lands on branch_placement_overrides, addressed
        // by the workspace_objects row PK so promote can rewrite both
        // the index and the leaf table authoritatively. path_cache
        // recompute is deferred to promote since the canonical folder
        // tree is unchanged on the branch until then.
        const { data: wo } = await supabase
          .from("workspace_objects")
          .select("id")
          .eq("object_type", draggedType)
          .eq("object_id", draggedId)
          .maybeSingle();
        if (wo?.id) {
          const { upsertPlacementOverride } = await import(
            "@/server/services/placement_branch_service"
          );
          await upsertPlacementOverride(supabase, {
            branchId: activeBranchId,
            actorId: userId,
            targetType: "workspace_object",
            targetId: wo.id,
            objectType: draggedType,
            objectId: draggedId,
            boxId,
            patch: {
              folderId: nextFolderId,
              folderIdOverridden: true,
            },
          });
        }
      } else {
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
    }

    // ── 2. Re-spread sibling sort_orders at the destination parent ─────────
    //
    // This is what makes reorder actually persist. We load every sibling
    // at (boxId, nextFolderId) in the display order the tree renders,
    // splice the dragged node into the requested position, and re-assign
    // all sort_orders with a gapped scheme. That guarantees the drop lands
    // exactly where the user released regardless of prior sort_order state.
    const siblings = await loadSiblings(
      supabase,
      boxId,
      nextFolderId,
      { type: draggedType, id: draggedId, isAttachment },
      activeBranchId ?? null
    );

    // Resolve the dragged row's PK — required by writeSiblingOrder
    // when routing through branch_placement_overrides.
    let draggedTargetId = "";
    if (isAttachment && (draggedType === "skill" || draggedType === "agent")) {
      const { data: att } = await supabase
        .from("box_object_attachments")
        .select("id")
        .eq("box_id", boxId)
        .eq("object_type", draggedType)
        .eq("object_id", draggedId)
        .maybeSingle();
      draggedTargetId = (att as { id?: string } | null)?.id ?? "";
    } else {
      const { data: wo } = await supabase
        .from("workspace_objects")
        .select("id")
        .eq("object_type", draggedType)
        .eq("object_id", draggedId)
        .maybeSingle();
      draggedTargetId = (wo as { id?: string } | null)?.id ?? "";
    }

    const draggedEntry: SiblingEntry = {
      source: (isAttachment && (draggedType === "skill" || draggedType === "agent"))
        ? "box_attachment"
        : "workspace_object",
      objectType: draggedType,
      objectId: draggedId,
      targetId: draggedTargetId,
      sortOrder: 0, // overwritten by writeSiblingOrder
      folderId: nextFolderId,
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
    await writeSiblingOrder(supabase, boxId, ordered, {
      branchId: activeBranchId ?? null,
      actorId: userId,
    });

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
