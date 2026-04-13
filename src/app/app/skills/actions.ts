"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createSkill } from "@/server/services/skill_service";
import { getBoxById } from "@/server/repositories/box_repository";
import { createLink, removeLink } from "@/server/services/object_link_service";
import { createFolder } from "@/server/services/folder_service";
import { createFile } from "@/server/services/file_service";
import {
  updateSkillContent,
  updateSkillContentOnBranch,
  getSkillForWorkspace,
} from "@/server/services/skill_service";
import {
  OBJECT_TYPE,
  SKILL_AGENT_FORMATS,
  type SkillAgentFormat,
  type ObjectType,
} from "@/server/domain/constants/object_constants";
import {
  type RelationshipType,
  RELATIONSHIP_TYPE,
} from "@/server/domain/constants/note_constants";

// ─── Result type ──────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_RELATIONSHIP_TYPES = new Set<string>(Object.values(RELATIONSHIP_TYPE));

// ─── Create skill (box-local) ─────────────────────────────────────────────────

export async function createSkillInBoxAction(
  boxId: string,
  params: {
    name: string;
    canonicalFormat: SkillAgentFormat;
    description?: string | null;
    folderId?: string | null;
    initialContent?: string;
  }
): Promise<ActionResult<{ id: string }>> {
  const trimmedName = params.name.trim();
  if (!trimmedName) return { ok: false, error: "Name is required" };
  if (trimmedName.length > 500) return { ok: false, error: "Name must not exceed 500 characters" };
  if (!SKILL_AGENT_FORMATS.includes(params.canonicalFormat as SkillAgentFormat)) {
    return { ok: false, error: "Invalid source format" };
  }

  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const box = await getBoxById(supabase, boxId);
    if (!box || box.workspace_id !== ctx.workspace.id) {
      return { ok: false, error: "Box not found" };
    }

    const skill = await createSkill(supabase, ctx.user.id, ctx.workspace.id, {
      boxId,
      folderId: params.folderId ?? null,
      name: trimmedName,
      sourceContent: params.initialContent?.trim() ?? "",
      canonicalFormat: params.canonicalFormat,
      description: params.description?.trim() || null,
      isReusable: false,
    });

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: skill.id } };
  } catch (err) {
    console.error("[createSkillInBoxAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create skill" };
  }
}

// ─── Create skill (workspace reusable) ───────────────────────────────────────

export async function createReusableSkillAction(
  params: {
    name: string;
    canonicalFormat: SkillAgentFormat;
    description?: string | null;
    initialContent?: string;
  }
): Promise<ActionResult<{ id: string }>> {
  const trimmedName = params.name.trim();
  if (!trimmedName) return { ok: false, error: "Name is required" };
  if (trimmedName.length > 500) return { ok: false, error: "Name must not exceed 500 characters" };
  if (!SKILL_AGENT_FORMATS.includes(params.canonicalFormat as SkillAgentFormat)) {
    return { ok: false, error: "Invalid source format" };
  }

  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const skill = await createSkill(supabase, ctx.user.id, ctx.workspace.id, {
      name: trimmedName,
      sourceContent: params.initialContent?.trim() ?? "",
      canonicalFormat: params.canonicalFormat,
      description: params.description?.trim() || null,
      isReusable: true,
    });

    const readme = await createFile(supabase, ctx.user.id, ctx.workspace.id, {
      boxId: null,
      folderId: null,
      name: "README",
      sourceContent: params.description?.trim()
        ? `# ${trimmedName}\n\n${params.description.trim()}\n`
        : `# ${trimmedName}\n`,
      canonicalFormat: "markdown",
      sourceLanguage: null,
      fileExtension: ".md",
      mimeType: "text/markdown",
    });
    await createLink(supabase, ctx.workspace.id, {
      sourceObjectType: OBJECT_TYPE.SKILL,
      sourceObjectId: skill.id,
      targetObjectType: OBJECT_TYPE.FILE,
      targetObjectId: readme.id,
      relationshipType: RELATIONSHIP_TYPE.PARENT_OF,
      relationshipNote: "Skill README",
    });

    revalidatePath("/app/skills");
    return { ok: true, data: { id: skill.id } };
  } catch (err) {
    console.error("[createReusableSkillAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create skill" };
  }
}

// ─── Rename skill ─────────────────────────────────────────────────────────────

export async function renameSkillAction(
  skillId: string,
  name: string
): Promise<ActionResult> {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "Name is required" };
  if (trimmedName.length > 500) return { ok: false, error: "Name must not exceed 500 characters" };

  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { data: skill, error: fetchError } = await supabase
      .from("skills")
      .select("id, box_id, workspace_id")
      .eq("id", skillId)
      .single();

    if (fetchError || !skill) return { ok: false, error: "Skill not found" };
    if (skill.workspace_id !== ctx.workspace.id) return { ok: false, error: "Skill not found" };

    const { error: updateError } = await supabase
      .from("skills")
      .update({ name: trimmedName })
      .eq("id", skillId);

    if (updateError) throw new Error(updateError.message);

    const { error: woError } = await supabase
      .from("workspace_objects")
      .update({ display_name: trimmedName })
      .eq("object_type", "skill")
      .eq("object_id", skillId);

    if (woError) {
      console.error("[renameSkillAction] Failed to sync workspace_objects display_name", woError);
    }

    revalidatePath("/app/skills");
    if (skill.box_id) revalidatePath(`/app/boxes/${skill.box_id}`);

    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[renameSkillAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rename skill" };
  }
}

// ─── Duplicate skill ──────────────────────────────────────────────────────────

export async function duplicateSkillAction(
  skillId: string,
  boxId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { data: skill, error: fetchError } = await supabase
      .from("skills")
      .select("*")
      .eq("id", skillId)
      .single();

    if (fetchError || !skill) return { ok: false, error: "Skill not found" };
    if (skill.workspace_id !== ctx.workspace.id) return { ok: false, error: "Skill not found" };

    const copy = await createSkill(supabase, ctx.user.id, ctx.workspace.id, {
      boxId,
      name: `Copy of ${skill.name}`,
      sourceContent: skill.source_content ?? "",
      canonicalFormat: skill.canonical_format,
      description: skill.description ?? null,
      tags: skill.tags ?? [],
      summary: skill.summary ?? null,
      isReusable: false,
    });

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: copy.id } };
  } catch (err) {
    console.error("[duplicateSkillAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to duplicate skill" };
  }
}

export async function saveSkillAction(
  skillId: string,
  params: {
    sourceContent: string;
    description?: string | null;
    tags?: string[];
    summary?: string | null;
  }
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    if (ctx.activeBranchId) {
      // Branch save. The canonical source lands on a new immutable
      // object_versions row via updateSkillContentOnBranch. Package
      // metadata (description / tags / summary) lands on the
      // branch_package_metadata overlay so the user's edits survive
      // on the branch without mutating main.
      await updateSkillContentOnBranch(
        supabase, ctx.user.id, ctx.workspace.id, ctx.activeBranchId, skillId, params.sourceContent
      );
      if (
        params.description !== undefined ||
        params.tags !== undefined ||
        params.summary !== undefined
      ) {
        const { upsertPackageMetadataOverlay } = await import(
          "@/server/services/package_branch_service"
        );
        await upsertPackageMetadataOverlay(supabase, {
          branchId: ctx.activeBranchId,
          packageType: "skill",
          packageId: skillId,
          description: params.description,
          tags: params.tags ?? undefined,
          summary: params.summary,
        });
      }
      return { ok: true, data: { id: skillId } };
    }
    const updated = await updateSkillContent(supabase, ctx.user.id, ctx.workspace.id, skillId, params);
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save skill" };
  }
}

export async function createSkillChildFolderAction(
  skillId: string,
  name: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const skill = await getSkillForWorkspace(supabase, skillId, ctx.workspace.id);
    if (!skill) return { ok: false, error: "Skill not found" };
    const folder = await createFolder(supabase, ctx.user.id, ctx.workspace.id, {
      boxId: skill.box_id ?? null,
      name: name.trim(),
      parentFolderId: skill.folder_id ?? null,
      parentSkillId: skillId,
    });
    await createLink(supabase, ctx.workspace.id, {
      sourceObjectType: OBJECT_TYPE.SKILL,
      sourceObjectId: skillId,
      targetObjectType: OBJECT_TYPE.FOLDER,
      targetObjectId: folder.id,
      relationshipType: RELATIONSHIP_TYPE.PARENT_OF,
      relationshipNote: "Skill child folder",
    });
    revalidatePath(`/app/skills/${skillId}`);
    if (skill.box_id) revalidatePath(`/app/boxes/${skill.box_id}`);
    else revalidatePath("/app/skills");
    return { ok: true, data: { id: folder.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create child folder" };
  }
}

export async function createSkillChildFileAction(
  skillId: string,
  params: {
    filename: string;
    canonicalFormat: SkillAgentFormat;
    initialContent?: string;
  }
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const skill = await getSkillForWorkspace(supabase, skillId, ctx.workspace.id);
    if (!skill) return { ok: false, error: "Skill not found" };

    // Branch-local creation when a draft branch is active: the file
    // lands with `branch_id` set and is invisible to main readers
    // until promote. This is the supported way to add a new child
    // file to a Skill package without leaking draft structure.
    const { createFile, createFileOnBranch } = await import(
      "@/server/services/file_service"
    );
    const createParams = {
      boxId: skill.box_id ?? null,
      folderId: skill.box_id ? (skill.folder_id ?? null) : null,
      name: params.filename.trim(),
      sourceContent: params.initialContent ?? "",
      canonicalFormat: params.canonicalFormat,
      sourceLanguage: null,
      fileExtension: null,
      mimeType: null,
    };
    const file = ctx.activeBranchId
      ? await createFileOnBranch(supabase, ctx.user.id, ctx.workspace.id, ctx.activeBranchId, createParams)
      : await createFile(supabase, ctx.user.id, ctx.workspace.id, createParams);

    // Set direct FK containment. parent_skill_id is a main-level
    // structural field, not branch-scoped — a branch-local file still
    // declares its parent skill so membership derivation works.
    await supabase.from("files").update({ parent_skill_id: skillId }).eq("id", file.id);
    await createLink(supabase, ctx.workspace.id, {
      sourceObjectType: OBJECT_TYPE.SKILL,
      sourceObjectId: skillId,
      targetObjectType: OBJECT_TYPE.FILE,
      targetObjectId: file.id,
      relationshipType: RELATIONSHIP_TYPE.PARENT_OF,
      relationshipNote: "Skill child file",
    });
    revalidatePath(`/app/skills/${skillId}`);
    if (skill.box_id) revalidatePath(`/app/boxes/${skill.box_id}`);
    else revalidatePath("/app/skills");
    return { ok: true, data: { id: file.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create child file" };
  }
}

// ─── Object links ─────────────────────────────────────────────────────────────

export async function createSkillObjectLinkAction(
  skillId: string,
  targetObjectType: ObjectType,
  targetObjectId: string,
  relationshipType: RelationshipType,
  relationshipNote?: string | null
): Promise<ActionResult<{ id: string }>> {
  if (!VALID_RELATIONSHIP_TYPES.has(relationshipType)) {
    return { ok: false, error: "Invalid relationship type" };
  }

  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const link = await createLink(supabase, ctx.workspace.id, {
      sourceObjectType: OBJECT_TYPE.SKILL,
      sourceObjectId: skillId,
      targetObjectType,
      targetObjectId,
      relationshipType,
      relationshipNote: relationshipNote ?? null,
    });

    return { ok: true, data: { id: link.id } };
  } catch (err) {
    console.error("[createSkillObjectLinkAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create link" };
  }
}

export async function deleteSkillObjectLinkAction(
  linkId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    await removeLink(supabase, ctx.workspace.id, linkId);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[deleteSkillObjectLinkAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete link" };
  }
}
