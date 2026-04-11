"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { renameFolder } from "@/server/services/folder_service";
import { createNote } from "@/server/services/note_service";
import { createFile } from "@/server/services/file_service";
import { createSkill } from "@/server/services/skill_service";
import { createAgent } from "@/server/services/agent_service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) throw new Error("Unauthenticated");
  const supabase = await createClient();
  return { supabase, userId: ctx.user.id, workspaceId: ctx.workspace.id };
}

// ─── Note actions ─────────────────────────────────────────────────────────────

export async function renameNoteAction(noteId: string, title: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const trimmed = title.trim();

    // Load note and verify ownership via box
    const { data: note, error: noteError } = await supabase
      .from("notes")
      .select("id, box_id")
      .eq("id", noteId)
      .single();
    if (noteError || !note) return { ok: false, error: "Note not found" };

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("workspace_id")
      .eq("id", note.box_id)
      .single();
    if (boxError || !box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Note not found" };
    }

    const { error } = await supabase
      .from("notes")
      .update({ title: trimmed })
      .eq("id", noteId);
    if (error) throw new Error(error.message);

    revalidatePath(`/app/notes/${noteId}`);
    revalidatePath(`/app/boxes/${note.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename note" };
  }
}

export async function duplicateNoteAction(noteId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    // Load full note row
    const { data: note, error: noteError } = await supabase
      .from("notes")
      .select("*")
      .eq("id", noteId)
      .single();
    if (noteError || !note) return { ok: false, error: "Note not found" };

    // Verify ownership via box
    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("workspace_id")
      .eq("id", note.box_id)
      .single();
    if (boxError || !box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Note not found" };
    }

    const newNote = await createNote(supabase, userId, workspaceId, {
      boxId: note.box_id,
      folderId: note.folder_id,
      title: `Copy of ${note.title}`,
      markdownContent: note.markdown_content,
      summary: note.summary,
      tags: note.tags,
    });

    revalidatePath(`/app/boxes/${note.box_id}`);
    return { ok: true, data: { id: newNote.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to duplicate note" };
  }
}

// ─── Folder actions ───────────────────────────────────────────────────────────

export async function renameFolderAction(folderId: string, name: string): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    // Load folder to get box_id for revalidation
    const { data: folder, error: folderError } = await supabase
      .from("folders")
      .select("id, box_id")
      .eq("id", folderId)
      .single();
    if (folderError || !folder) return { ok: false, error: "Folder not found" };

    // Verify via box ownership
    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("workspace_id")
      .eq("id", folder.box_id)
      .single();
    if (boxError || !box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Folder not found" };
    }

    await renameFolder(supabase, userId, workspaceId, folderId, name.trim());

    revalidatePath(`/app/boxes/${folder.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename folder" };
  }
}

export async function trashFolderAction(folderId: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();

    // Load folder, verify ownership
    const { data: folder, error: folderError } = await supabase
      .from("folders")
      .select("id, box_id")
      .eq("id", folderId)
      .single();
    if (folderError || !folder) return { ok: false, error: "Folder not found" };

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("workspace_id")
      .eq("id", folder.box_id)
      .single();
    if (boxError || !box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Folder not found" };
    }

    const { error } = await supabase
      .from("folders")
      .update({ status: "trashed" })
      .eq("id", folderId);
    if (error) throw new Error(error.message);

    revalidatePath(`/app/boxes/${folder.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash folder" };
  }
}

// ─── Move object to folder action ─────────────────────────────────────────────

export async function moveObjectToFolderAction(
  objectType: "note" | "file" | "skill" | "agent",
  objectId: string,
  boxId: string,
  targetFolderId: string | null
): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();

    // Verify box ownership
    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("workspace_id")
      .eq("id", boxId)
      .single();
    if (boxError || !box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Box not found" };
    }

    // Resolve target folder path_cache
    let targetFolderPathCache = "";
    if (targetFolderId) {
      const { data: targetFolder, error: folderError } = await supabase
        .from("folders")
        .select("id, box_id, path_cache")
        .eq("id", targetFolderId)
        .single();
      if (folderError || !targetFolder) return { ok: false, error: "Target folder not found" };
      if (targetFolder.box_id !== boxId) return { ok: false, error: "Target folder does not belong to this box" };
      targetFolderPathCache = targetFolder.path_cache;
    }

    // Retrieve the object's current slug, verify box_id
    const table = objectType === "note" ? "notes"
      : objectType === "file" ? "files"
      : objectType === "skill" ? "skills"
      : "agents";

    const titleField = objectType === "note" ? "title" : "name";

    const { data: obj, error: objError } = await supabase
      .from(table)
      .select(`id, box_id, slug, ${titleField}`)
      .eq("id", objectId)
      .single();
    if (objError || !obj) return { ok: false, error: `${objectType} not found` };
    if (obj.box_id !== boxId) return { ok: false, error: `${objectType} does not belong to this box` };

    const slug: string = obj.slug;
    const newPathCache = targetFolderPathCache
      ? `${targetFolderPathCache}/${slug}`
      : slug;

    const { error: updateError } = await supabase
      .from(table)
      .update({ folder_id: targetFolderId, path_cache: newPathCache })
      .eq("id", objectId);
    if (updateError) throw new Error(updateError.message);

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to move object" };
  }
}

// ─── File actions ─────────────────────────────────────────────────────────────

export async function renameFileAction(fileId: string, name: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const trimmed = name.trim();

    // Load file, verify ownership
    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, box_id, workspace_id")
      .eq("id", fileId)
      .single();
    if (fileError || !file) return { ok: false, error: "File not found" };

    if (file.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", file.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "File not found" };
      }
    } else if (file.workspace_id !== workspaceId) {
      return { ok: false, error: "File not found" };
    }

    const { error: updateError } = await supabase
      .from("files")
      .update({ name: trimmed })
      .eq("id", fileId);
    if (updateError) throw new Error(updateError.message);

    await supabase
      .from("workspace_objects")
      .update({ display_name: trimmed })
      .eq("object_type", "file")
      .eq("object_id", fileId);

    if (file.box_id) revalidatePath(`/app/boxes/${file.box_id}`);
    revalidatePath(`/app/files/${fileId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename file" };
  }
}

export async function duplicateFileAction(fileId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    // Load full file row
    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .single();
    if (fileError || !file) return { ok: false, error: "File not found" };

    // Verify ownership
    if (file.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", file.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "File not found" };
      }
    } else if (file.workspace_id !== workspaceId) {
      return { ok: false, error: "File not found" };
    }

    const newFile = await createFile(supabase, userId, workspaceId, {
      boxId: file.box_id,
      folderId: file.folder_id,
      name: `Copy of ${file.name}`,
      sourceContent: file.source_content,
      canonicalFormat: file.canonical_format,
      sourceLanguage: file.source_language,
      fileExtension: file.file_extension,
      mimeType: file.mime_type,
      description: file.description,
      tags: file.tags,
      summary: file.summary,
    });

    if (file.box_id) revalidatePath(`/app/boxes/${file.box_id}`);
    return { ok: true, data: { id: newFile.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to duplicate file" };
  }
}

// ─── Skill actions ────────────────────────────────────────────────────────────

export async function renameSkillAction(skillId: string, name: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const trimmed = name.trim();

    const { data: skill, error: skillError } = await supabase
      .from("skills")
      .select("id, box_id, workspace_id")
      .eq("id", skillId)
      .single();
    if (skillError || !skill) return { ok: false, error: "Skill not found" };

    if (skill.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", skill.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "Skill not found" };
      }
    } else if (skill.workspace_id !== workspaceId) {
      return { ok: false, error: "Skill not found" };
    }

    const { error: updateError } = await supabase
      .from("skills")
      .update({ name: trimmed })
      .eq("id", skillId);
    if (updateError) throw new Error(updateError.message);

    await supabase
      .from("workspace_objects")
      .update({ display_name: trimmed })
      .eq("object_type", "skill")
      .eq("object_id", skillId);

    if (skill.box_id) revalidatePath(`/app/boxes/${skill.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename skill" };
  }
}

export async function duplicateSkillAction(skillId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const { data: skill, error: skillError } = await supabase
      .from("skills")
      .select("*")
      .eq("id", skillId)
      .single();
    if (skillError || !skill) return { ok: false, error: "Skill not found" };

    if (skill.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", skill.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "Skill not found" };
      }
    } else if (skill.workspace_id !== workspaceId) {
      return { ok: false, error: "Skill not found" };
    }

    const newSkill = await createSkill(supabase, userId, workspaceId, {
      boxId: skill.box_id,
      folderId: skill.folder_id,
      name: `Copy of ${skill.name}`,
      sourceContent: skill.source_content,
      canonicalFormat: skill.canonical_format,
      description: skill.description,
      tags: skill.tags,
      summary: skill.summary,
    });

    if (skill.box_id) revalidatePath(`/app/boxes/${skill.box_id}`);
    return { ok: true, data: { id: newSkill.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to duplicate skill" };
  }
}

// ─── Trash actions ────────────────────────────────────────────────────────────

export async function trashNoteAction(noteId: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();

    const { data: note, error: noteError } = await supabase
      .from("notes")
      .select("id, box_id")
      .eq("id", noteId)
      .single();
    if (noteError || !note) return { ok: false, error: "Note not found" };

    const { data: box, error: boxError } = await supabase
      .from("boxes")
      .select("workspace_id")
      .eq("id", note.box_id)
      .single();
    if (boxError || !box || box.workspace_id !== workspaceId) {
      return { ok: false, error: "Note not found" };
    }

    const { error } = await supabase
      .from("notes")
      .update({ status: "trashed" })
      .eq("id", noteId);
    if (error) throw new Error(error.message);

    revalidatePath(`/app/boxes/${note.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash note" };
  }
}

export async function trashFileAction(fileId: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();

    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, box_id, workspace_id")
      .eq("id", fileId)
      .single();
    if (fileError || !file) return { ok: false, error: "File not found" };

    if (file.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", file.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "File not found" };
      }
    } else if (file.workspace_id !== workspaceId) {
      return { ok: false, error: "File not found" };
    }

    const { error } = await supabase
      .from("files")
      .update({ status: "trashed" })
      .eq("id", fileId);
    if (error) throw new Error(error.message);

    if (file.box_id) revalidatePath(`/app/boxes/${file.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash file" };
  }
}

export async function trashSkillAction(skillId: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();

    const { data: skill, error: skillError } = await supabase
      .from("skills")
      .select("id, box_id, workspace_id")
      .eq("id", skillId)
      .single();
    if (skillError || !skill) return { ok: false, error: "Skill not found" };

    if (skill.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", skill.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "Skill not found" };
      }
    } else if (skill.workspace_id !== workspaceId) {
      return { ok: false, error: "Skill not found" };
    }

    const { error } = await supabase
      .from("skills")
      .update({ status: "trashed" })
      .eq("id", skillId);
    if (error) throw new Error(error.message);

    if (skill.box_id) revalidatePath(`/app/boxes/${skill.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash skill" };
  }
}

export async function trashAgentAction(agentId: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, box_id, workspace_id")
      .eq("id", agentId)
      .single();
    if (agentError || !agent) return { ok: false, error: "Agent not found" };

    if (agent.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", agent.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "Agent not found" };
      }
    } else if (agent.workspace_id !== workspaceId) {
      return { ok: false, error: "Agent not found" };
    }

    const { error } = await supabase
      .from("agents")
      .update({ status: "trashed" })
      .eq("id", agentId);
    if (error) throw new Error(error.message);

    if (agent.box_id) revalidatePath(`/app/boxes/${agent.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to trash agent" };
  }
}

// ─── Agent actions ────────────────────────────────────────────────────────────

export async function renameAgentAction(agentId: string, name: string): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();
    const trimmed = name.trim();

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, box_id, workspace_id")
      .eq("id", agentId)
      .single();
    if (agentError || !agent) return { ok: false, error: "Agent not found" };

    if (agent.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", agent.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "Agent not found" };
      }
    } else if (agent.workspace_id !== workspaceId) {
      return { ok: false, error: "Agent not found" };
    }

    const { error: updateError } = await supabase
      .from("agents")
      .update({ name: trimmed })
      .eq("id", agentId);
    if (updateError) throw new Error(updateError.message);

    await supabase
      .from("workspace_objects")
      .update({ display_name: trimmed })
      .eq("object_type", "agent")
      .eq("object_id", agentId);

    if (agent.box_id) revalidatePath(`/app/boxes/${agent.box_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename agent" };
  }
}

export async function duplicateAgentAction(agentId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();
    if (agentError || !agent) return { ok: false, error: "Agent not found" };

    if (agent.box_id) {
      const { data: box, error: boxError } = await supabase
        .from("boxes")
        .select("workspace_id")
        .eq("id", agent.box_id)
        .single();
      if (boxError || !box || box.workspace_id !== workspaceId) {
        return { ok: false, error: "Agent not found" };
      }
    } else if (agent.workspace_id !== workspaceId) {
      return { ok: false, error: "Agent not found" };
    }

    const newAgent = await createAgent(supabase, userId, workspaceId, {
      boxId: agent.box_id,
      folderId: agent.folder_id,
      name: `Copy of ${agent.name}`,
      sourceContent: agent.source_content,
      canonicalFormat: agent.canonical_format,
      agentType: agent.agent_type,
      modelHint: agent.model_hint,
      systemPrompt: agent.system_prompt,
      description: agent.description,
      tags: agent.tags,
      summary: agent.summary,
    });

    if (agent.box_id) revalidatePath(`/app/boxes/${agent.box_id}`);
    return { ok: true, data: { id: newAgent.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to duplicate agent" };
  }
}
