/**
 * Skill service.
 *
 * Skills can be:
 *   - Box-local: box_id set, is_reusable = false
 *   - Workspace-level reusable: is_reusable = true, box_id may be null
 *     Reusable skills can be attached into boxes via box_object_attachments.
 *
 * External writes to workspace-level reusable skills must go through proposals.
 * Human writes are direct.
 *
 * Create and update operations go through Postgres RPC functions
 * (create_object_with_initial_version / update_object_and_create_version)
 * to ensure skill content and version snapshots are written atomically.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type Skill } from "@/server/domain/types/skill";
import { type ObjectVersion } from "@/server/domain/types/object_version";
import { type BoxObjectAttachment } from "@/server/domain/types/box_object_attachment";
import { slugify } from "@/lib/slugify";
import { getFolderById } from "@/server/repositories/folder_repository";
import {
  OBJECT_TYPE,
  OBJECT_STATUS,
  OBJECT_ORIGIN_TYPE,
  type SkillAgentFormat,
} from "@/server/domain/constants/object_constants";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ObjectRpcResult {
  object: Skill;
  version: ObjectVersion;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Write an audit event for a skill operation, swallowing errors. */
async function writeSkillAudit(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  skillId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: actorId,
      object_type: "skill",
      object_id: skillId,
      event_type: eventType,
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.error(`[audit] Failed to write ${eventType} for skill/${skillId}`, err);
  }
}

/** Check whether a path_cache is already taken in a box (excluding trashed skills). */
async function pathCacheExistsInSkills(
  supabase: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await supabase
    .from("skills")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", OBJECT_STATUS.TRASHED)
    .maybeSingle();
  return !!data;
}

/** Build path_cache from folder (if any) + slug. */
async function buildPathCache(
  supabase: SupabaseClient,
  folderId: string | null | undefined,
  slug: string
): Promise<string> {
  if (!folderId) return slug;
  const folder = await getFolderById(supabase, folderId);
  if (!folder) throw new Error(`Folder not found: ${folderId}`);
  return `${folder.path_cache}/${slug}`;
}

/** Generate a unique slug/path_cache for a skill in a given box+folder. */
async function uniqueSkillSlug(
  supabase: SupabaseClient,
  boxId: string | null | undefined,
  folderId: string | null | undefined,
  name: string
): Promise<{ slug: string; pathCache: string }> {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  let pathCache = await buildPathCache(supabase, folderId, slug);

  if (boxId) {
    while (await pathCacheExistsInSkills(supabase, boxId, pathCache)) {
      slug = `${base}-${suffix++}`;
      pathCache = await buildPathCache(supabase, folderId, slug);
    }
  }

  return { slug, pathCache };
}

/** Verify a skill belongs to the given workspace. */
async function verifySkillWorkspaceOwnership(
  supabase: SupabaseClient,
  skill: Skill,
  workspaceId: string
): Promise<void> {
  if (!skill.box_id) {
    if (skill.workspace_id !== workspaceId) {
      throw new Error("Skill does not belong to the specified workspace");
    }
    return;
  }
  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", skill.box_id)
    .single();
  if (!box || box.workspace_id !== workspaceId) {
    throw new Error("Skill does not belong to the specified workspace");
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listSkills(
  supabase: SupabaseClient,
  boxId: string
): Promise<Skill[]> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .eq("box_id", boxId)
    .neq("status", OBJECT_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Skill[];
}

/**
 * List all workspace-level reusable skills for a workspace.
 */
export async function listReusableSkills(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Skill[]> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_reusable", true)
    .neq("status", OBJECT_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Skill[];
}

/**
 * Fetch a skill, verifying it belongs to the given workspace.
 * Returns null if not found or not owned.
 */
export async function getSkillForWorkspace(
  supabase: SupabaseClient,
  skillId: string,
  workspaceId: string
): Promise<Skill | null> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .eq("id", skillId)
    .single();

  if (error || !data) return null;
  const skill = data as Skill;

  try {
    await verifySkillWorkspaceOwnership(supabase, skill, workspaceId);
  } catch {
    return null;
  }

  return skill;
}

/**
 * Create a skill and its initial version atomically via RPC.
 * Registers the skill in workspace_objects.
 * Returns the created Skill.
 */
export async function createSkill(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  params: {
    boxId?: string | null;
    folderId?: string | null;
    name: string;
    sourceContent?: string;
    canonicalFormat?: SkillAgentFormat;
    description?: string | null;
    summary?: string | null;
    tags?: string[];
    isReusable?: boolean;
  }
): Promise<Skill> {
  const {
    boxId,
    folderId,
    name,
    sourceContent = "",
    canonicalFormat = "markdown",
    description,
    summary,
    tags = [],
    isReusable = false,
  } = params;

  if (!boxId && !isReusable) {
    throw new Error("boxId is required for box-local skills (isReusable=false)");
  }

  const { slug, pathCache } = await uniqueSkillSlug(supabase, boxId, folderId, name);
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");

  const { data, error } = await supabase.rpc("create_object_with_initial_version", {
    p_object_type: OBJECT_TYPE.SKILL,
    p_workspace_id: workspaceId,
    p_box_id: boxId ?? null,
    p_folder_id: folderId ?? null,
    p_name: name,
    p_slug: slug,
    p_path_cache: pathCache,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_canonical_format: canonicalFormat,
    p_description: description ?? null,
    p_tags: tags,
    p_summary: summary ?? null,
    p_is_reusable: isReusable,
    p_origin_type: OBJECT_ORIGIN_TYPE.USER_CREATED,
    p_actor_id: userId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create skill");
  }

  const result = data as ObjectRpcResult;
  const skill = result.object;

  // Register in workspace_objects
  const { error: regError } = await supabase
    .from("workspace_objects")
    .insert({
      workspace_id: workspaceId,
      box_id: boxId ?? null,
      folder_id: folderId ?? null,
      object_type: OBJECT_TYPE.SKILL,
      object_id: skill.id,
      display_name: name,
      status: OBJECT_STATUS.ACTIVE,
      is_reusable: isReusable,
    });

  if (regError) {
    console.error("[skill_service] Failed to register workspace object for skill", skill.id, regError);
  }

  await writeSkillAudit(supabase, workspaceId, userId, skill.id, "skill.created", {
    name,
    box_id: boxId ?? null,
    folder_id: folderId ?? null,
    is_reusable: isReusable,
  });

  return skill;
}

/**
 * Update a skill's content and metadata, creating a new version atomically via RPC.
 * Returns the updated Skill.
 */
export async function updateSkillContent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  skillId: string,
  params: {
    sourceContent?: string;
    description?: string | null;
    tags?: string[];
    summary?: string | null;
  }
): Promise<Skill> {
  const existing = await getSkillForWorkspace(supabase, skillId, workspaceId);
  if (!existing) {
    throw new Error(`Skill not found or not accessible: ${skillId}`);
  }

  const {
    sourceContent = existing.source_content,
    description,
    tags,
    summary,
  } = params;
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");

  const { data, error } = await supabase.rpc("update_object_and_create_version", {
    p_object_type: OBJECT_TYPE.SKILL,
    p_object_id: skillId,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_description: description !== undefined ? description : existing.description,
    p_tags: tags !== undefined ? tags : existing.tags,
    p_summary: summary !== undefined ? summary : existing.summary,
    p_actor_id: userId,
    p_change_origin: "human_edit",
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update skill");
  }

  const result = data as ObjectRpcResult;
  const updatedSkill = result.object;

  // Sync display_name in workspace_objects
  const { error: syncError } = await supabase
    .from("workspace_objects")
    .update({ display_name: updatedSkill.name, updated_at: new Date().toISOString() })
    .eq("object_type", OBJECT_TYPE.SKILL)
    .eq("object_id", skillId);

  if (syncError) {
    console.error("[skill_service] Failed to sync workspace_objects display_name for skill", skillId, syncError);
  }

  await writeSkillAudit(supabase, workspaceId, userId, skillId, "skill.updated", {
    name: updatedSkill.name,
    box_id: existing.box_id,
  });

  return updatedSkill;
}

/**
 * Attach a reusable skill into a box by reference.
 * Creates a box_object_attachment row.
 * The skill must have is_reusable = true.
 */
export async function attachSkillToBox(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  skillId: string,
  boxId: string,
  folderId?: string | null
): Promise<BoxObjectAttachment> {
  const skill = await getSkillForWorkspace(supabase, skillId, workspaceId);
  if (!skill) {
    throw new Error(`Skill not found or not accessible: ${skillId}`);
  }
  if (!skill.is_reusable) {
    throw new Error(`Skill ${skillId} is not reusable and cannot be attached to a box`);
  }

  // Verify box belongs to this workspace
  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", boxId)
    .single();
  if (!box || box.workspace_id !== workspaceId) {
    throw new Error(`Box ${boxId} does not belong to workspace ${workspaceId}`);
  }

  const { data, error } = await supabase
    .from("box_object_attachments")
    .insert({
      workspace_id: workspaceId,
      box_id: boxId,
      folder_id: folderId ?? null,
      object_type: OBJECT_TYPE.SKILL,
      object_id: skillId,
      attached_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to attach skill to box");
  }

  await writeSkillAudit(supabase, workspaceId, userId, skillId, "skill.attached", {
    box_id: boxId,
    folder_id: folderId ?? null,
  });

  return data as BoxObjectAttachment;
}
