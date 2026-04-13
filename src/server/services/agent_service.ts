/**
 * Agent service.
 *
 * Agents can be:
 *   - Box-local: box_id set, is_reusable = false
 *   - Workspace-level reusable: is_reusable = true, box_id may be null
 *     Reusable agents can be attached into boxes via box_object_attachments.
 *
 * External writes to workspace-level reusable agents must go through proposals.
 * Human writes are direct.
 *
 * Create and update operations go through Postgres RPC functions
 * (create_object_with_initial_version / update_object_and_create_version)
 * to ensure agent content and version snapshots are written atomically.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type Agent } from "@/server/domain/types/agent";
import { type ObjectVersion } from "@/server/domain/types/object_version";
import { type BoxObjectAttachment } from "@/server/domain/types/box_object_attachment";
import { slugify } from "@/lib/slugify";
import { getFolderById } from "@/server/repositories/folder_repository";
import {
  OBJECT_TYPE,
  OBJECT_STATUS,
  OBJECT_ORIGIN_TYPE,
  type AgentType,
  type SkillAgentFormat,
} from "@/server/domain/constants/object_constants";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ObjectRpcResult {
  object: Agent;
  version: ObjectVersion;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Write an audit event for an agent operation, swallowing errors. */
async function writeAgentAudit(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  agentId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: actorId,
      object_type: "agent",
      object_id: agentId,
      event_type: eventType,
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.error(`[audit] Failed to write ${eventType} for agent/${agentId}`, err);
  }
}

/** Check whether a path_cache is already taken in a box (excluding trashed agents). */
async function pathCacheExistsInAgents(
  supabase: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await supabase
    .from("agents")
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

/** Generate a unique slug/path_cache for an agent in a given box+folder. */
async function uniqueAgentSlug(
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
    while (await pathCacheExistsInAgents(supabase, boxId, pathCache)) {
      slug = `${base}-${suffix++}`;
      pathCache = await buildPathCache(supabase, folderId, slug);
    }
  }

  return { slug, pathCache };
}

/** Verify an agent belongs to the given workspace. */
async function verifyAgentWorkspaceOwnership(
  supabase: SupabaseClient,
  agent: Agent,
  workspaceId: string
): Promise<void> {
  if (!agent.box_id) {
    if (agent.workspace_id !== workspaceId) {
      throw new Error("Agent does not belong to the specified workspace");
    }
    return;
  }
  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", agent.box_id)
    .single();
  if (!box || box.workspace_id !== workspaceId) {
    throw new Error("Agent does not belong to the specified workspace");
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listAgents(
  supabase: SupabaseClient,
  boxId: string
): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("box_id", boxId)
    .neq("status", OBJECT_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Agent[];
}

/**
 * List all workspace-level reusable agents for a workspace.
 */
export async function listReusableAgents(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_reusable", true)
    .neq("status", OBJECT_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as Agent[];
}

/**
 * Fetch an agent, verifying it belongs to the given workspace.
 * Returns null if not found or not owned.
 *
 * When `branchId` is provided AND a branch head exists for this
 * agent's canonical source, the returned Agent's `source_content`,
 * `content_bytes`, and `current_version_id` are patched from the
 * branch version. Child files / child folders remain on main —
 * only the canonical editable source is branch-aware in V1. See
 * `docs/branch_aware_writes_v1.md`.
 */
export async function getAgentForWorkspace(
  supabase: SupabaseClient,
  agentId: string,
  workspaceId: string,
  branchId: string | null = null
): Promise<Agent | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (error || !data) return null;
  const agent = data as Agent;

  try {
    await verifyAgentWorkspaceOwnership(supabase, agent, workspaceId);
  } catch {
    return null;
  }

  if (branchId) {
    const { resolveBranchObjectVersion } = await import("./object_branch_service");
    const { getPackageMetadataOverlay, applyPackageMetadataOverlay } = await import(
      "./package_branch_service"
    );
    const branchVer = await resolveBranchObjectVersion(supabase, branchId, "agent", agentId);
    let overlayed = agent;
    if (branchVer) {
      overlayed = {
        ...overlayed,
        source_content: branchVer.source_content,
        content_bytes: branchVer.content_bytes,
        current_version_id: branchVer.id,
      } as Agent;
    }
    // Package metadata overlay: description / tags / summary /
    // agent_type / model_hint / system_prompt.
    const overlay = await getPackageMetadataOverlay(supabase, branchId, "agent", agentId);
    if (overlay) {
      overlayed = applyPackageMetadataOverlay(overlayed as unknown as Record<string, unknown>, overlay) as unknown as Agent;
    }
    if (branchVer || overlay) return overlayed;
  }

  return agent;
}

/**
 * Branch-aware write for an agent's canonical editable source.
 * Reusable agents and workspace-local agents both route through
 * here; the underlying `object_versions` row is identical.
 */
export async function updateAgentContentOnBranch(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  branchId: string,
  agentId: string,
  sourceContent: string
) {
  const { updateObjectContentOnBranch } = await import("./object_branch_service");
  return updateObjectContentOnBranch(
    supabase, userId, workspaceId, branchId, "agent", agentId, { sourceContent }
  );
}

/**
 * Create an agent and its initial version atomically via RPC.
 * Registers the agent in workspace_objects.
 * Returns the created Agent.
 */
export async function createAgent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  params: {
    boxId?: string | null;
    folderId?: string | null;
    name: string;
    sourceContent?: string;
    canonicalFormat?: SkillAgentFormat;
    agentType?: AgentType | null;
    modelHint?: string | null;
    systemPrompt?: string | null;
    description?: string | null;
    summary?: string | null;
    tags?: string[];
    isReusable?: boolean;
  }
): Promise<Agent> {
  const {
    boxId,
    folderId,
    name,
    sourceContent = "",
    canonicalFormat = "markdown",
    agentType,
    modelHint,
    systemPrompt,
    description,
    summary,
    tags = [],
    isReusable = false,
  } = params;

  if (!boxId && !isReusable) {
    throw new Error("boxId is required for box-local agents (isReusable=false)");
  }

  const { slug, pathCache } = await uniqueAgentSlug(supabase, boxId, folderId, name);
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");

  const { data, error } = await supabase.rpc("create_object_with_initial_version", {
    p_object_type: OBJECT_TYPE.AGENT,
    p_workspace_id: workspaceId,
    p_box_id: boxId ?? null,
    p_folder_id: folderId ?? null,
    p_name: name,
    p_slug: slug,
    p_path_cache: pathCache,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_canonical_format: canonicalFormat,
    p_agent_type: agentType ?? null,
    p_model_hint: modelHint ?? null,
    p_system_prompt: systemPrompt ?? null,
    p_description: description ?? null,
    p_tags: tags,
    p_summary: summary ?? null,
    p_is_reusable: isReusable,
    p_origin_type: OBJECT_ORIGIN_TYPE.USER_CREATED,
    p_actor_id: userId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create agent");
  }

  const result = data as ObjectRpcResult;
  const agent = result.object;

  // Register in workspace_objects
  const { error: regError } = await supabase
    .from("workspace_objects")
    .insert({
      workspace_id: workspaceId,
      box_id: boxId ?? null,
      folder_id: folderId ?? null,
      object_type: OBJECT_TYPE.AGENT,
      object_id: agent.id,
      display_name: name,
      status: OBJECT_STATUS.ACTIVE,
      is_reusable: isReusable,
      sort_order: Date.now(),
    });

  if (regError) {
    console.error("[agent_service] Failed to register workspace object for agent", agent.id, regError);
  }

  await writeAgentAudit(supabase, workspaceId, userId, agent.id, "agent.created", {
    name,
    box_id: boxId ?? null,
    folder_id: folderId ?? null,
    is_reusable: isReusable,
  });

  return agent;
}

/**
 * Update an agent's content and metadata, creating a new version atomically via RPC.
 * Returns the updated Agent.
 */
export async function updateAgentContent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  agentId: string,
  params: {
    sourceContent?: string;
    agentType?: AgentType | null;
    modelHint?: string | null;
    systemPrompt?: string | null;
    description?: string | null;
    tags?: string[];
    summary?: string | null;
  }
): Promise<Agent> {
  const existing = await getAgentForWorkspace(supabase, agentId, workspaceId);
  if (!existing) {
    throw new Error(`Agent not found or not accessible: ${agentId}`);
  }

  const {
    sourceContent = existing.source_content,
    agentType,
    modelHint,
    systemPrompt,
    description,
    tags,
    summary,
  } = params;
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");

  const { data, error } = await supabase.rpc("update_object_and_create_version", {
    p_object_type: OBJECT_TYPE.AGENT,
    p_object_id: agentId,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_agent_type: agentType !== undefined ? agentType : existing.agent_type,
    p_model_hint: modelHint !== undefined ? modelHint : existing.model_hint,
    p_system_prompt: systemPrompt !== undefined ? systemPrompt : existing.system_prompt,
    p_description: description !== undefined ? description : existing.description,
    p_tags: tags !== undefined ? tags : existing.tags,
    p_summary: summary !== undefined ? summary : existing.summary,
    p_actor_id: userId,
    p_change_origin: "human_edit",
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update agent");
  }

  const result = data as ObjectRpcResult;
  const updatedAgent = result.object;

  // Sync display_name in workspace_objects
  const { error: syncError } = await supabase
    .from("workspace_objects")
    .update({ display_name: updatedAgent.name, updated_at: new Date().toISOString() })
    .eq("object_type", OBJECT_TYPE.AGENT)
    .eq("object_id", agentId);

  if (syncError) {
    console.error("[agent_service] Failed to sync workspace_objects display_name for agent", agentId, syncError);
  }

  await writeAgentAudit(supabase, workspaceId, userId, agentId, "agent.updated", {
    name: updatedAgent.name,
    box_id: existing.box_id,
  });

  return updatedAgent;
}

/**
 * Attach a reusable agent into a box by reference.
 * Creates a box_object_attachment row.
 * The agent must have is_reusable = true.
 */
export async function attachAgentToBox(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  agentId: string,
  boxId: string,
  folderId?: string | null
): Promise<BoxObjectAttachment> {
  const agent = await getAgentForWorkspace(supabase, agentId, workspaceId);
  if (!agent) {
    throw new Error(`Agent not found or not accessible: ${agentId}`);
  }
  if (!agent.is_reusable) {
    throw new Error(`Agent ${agentId} is not reusable and cannot be attached to a box`);
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
      object_type: OBJECT_TYPE.AGENT,
      object_id: agentId,
      attached_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to attach agent to box");
  }

  await writeAgentAudit(supabase, workspaceId, userId, agentId, "agent.attached", {
    box_id: boxId,
    folder_id: folderId ?? null,
  });

  return data as BoxObjectAttachment;
}
