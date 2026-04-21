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
 *
 * When `branchId` is provided AND a branch head exists for this
 * skill's canonical source, the returned Skill's `source_content`,
 * `content_bytes`, and `current_version_id` are patched from the
 * branch version. Child files / child folders remain on main —
 * only the canonical editable source is branch-aware in V1. See
 * `docs/branch_aware_writes_v1.md`.
 */
export async function getSkillForWorkspace(
  supabase: SupabaseClient,
  skillId: string,
  workspaceId: string,
  branchId: string | null = null
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

  if (branchId) {
    const { resolveBranchObjectVersion } = await import("./object_branch_service");
    const { getPackageMetadataOverlay, applyPackageMetadataOverlay } = await import(
      "./package_branch_service"
    );
    const branchVer = await resolveBranchObjectVersion(supabase, branchId, "skill", skillId);
    let overlayed = skill;
    if (branchVer) {
      overlayed = {
        ...overlayed,
        source_content: branchVer.source_content,
        content_bytes: branchVer.content_bytes,
        current_version_id: branchVer.id,
      } as Skill;
    }
    // Package metadata overlay: description / tags / summary.
    const overlay = await getPackageMetadataOverlay(supabase, branchId, "skill", skillId);
    if (overlay) {
      overlayed = applyPackageMetadataOverlay(overlayed as unknown as Record<string, unknown>, overlay) as unknown as Skill;
    }
    // Only return overlay'd row when something actually differs;
    // otherwise fall through to main for cleanliness.
    if (branchVer || overlay) return overlayed;
  }

  return skill;
}

/**
 * Branch-aware write for a skill's canonical editable source.
 * Reusable skills and workspace-local skills both route through
 * here; the underlying `object_versions` row is identical.
 */
export async function updateSkillContentOnBranch(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  branchId: string,
  skillId: string,
  sourceContent: string
) {
  const { updateObjectContentOnBranch } = await import("./object_branch_service");
  return updateObjectContentOnBranch(
    supabase, userId, workspaceId, branchId, "skill", skillId, { sourceContent }
  );
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
      sort_order: Date.now(),
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
 * Create a skill whose existence is scoped to a draft branch.
 *
 * Mirrors `createFileOnBranch` in file_service.ts: we call the
 * normal `createSkill` path first (atomic RPC + workspace_objects +
 * audit), then stamp `branch_id` on the resulting row. Until
 * promote, main-scoped readers filter out rows with
 * `branch_id IS NOT NULL`; branch readers union main with rows
 * where `branch_id = <active branch>`.
 *
 * TODO: there is currently no dedicated `create_skill_on_branch`
 * RPC. This function uses the same RPC as `createSkill` plus a
 * manual `branch_id` UPDATE, which means the branch stamp is not
 * applied atomically with the initial version insert. A follow-up
 * should add a branch-aware RPC so the branch_id is set inside the
 * same transaction as the initial insert.
 */
export async function createSkillOnBranch(
  supabase: SupabaseClient,
  actorId: string,
  workspaceId: string,
  branchId: string,
  input: Parameters<typeof createSkill>[3]
): Promise<Skill> {
  // Re-validate the branch is open and belongs to this workspace
  // up-front so we never write a skill pointing at a stale branch.
  const { data: branch } = await supabase
    .from("draft_branches")
    .select("id, workspace_id, status")
    .eq("id", branchId)
    .maybeSingle();
  if (!branch || branch.workspace_id !== workspaceId || branch.status !== "open") {
    throw new Error("Branch not found or not open");
  }

  const skill = await createSkill(supabase, actorId, workspaceId, input);

  // Stamp branch_id on the skill row. We also mirror the column onto
  // workspace_objects so tree / navigation filters that read the
  // registry can scope branch-local rows just as cheaply as the
  // skills table.
  await supabase
    .from("skills")
    .update({ branch_id: branchId })
    .eq("id", skill.id);

  // Distinct audit event: "skill.branch_created" — separate from
  // "skill.created" so the Audit Log makes branch-scoped structural
  // creation easy to filter.
  await writeSkillAudit(supabase, workspaceId, actorId, skill.id, "skill.branch_created", {
    branch_id: branchId,
    box_id: skill.box_id,
    folder_id: skill.folder_id ?? null,
    is_reusable: skill.is_reusable,
  });

  return { ...skill, branch_id: branchId } as Skill;
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
