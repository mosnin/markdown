"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getAgentForWorkspace, createAgent, updateAgentContent } from "@/server/services/agent_service";
import { updateAgent } from "@/server/repositories/agent_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { createLink, removeLink } from "@/server/services/object_link_service";
import { createFolder } from "@/server/services/folder_service";
import { createFile } from "@/server/services/file_service";
import { getSkillForWorkspace } from "@/server/services/skill_service";
import {
  OBJECT_TYPE,
  SKILL_AGENT_FORMATS,
  type SkillAgentFormat,
  type AgentType,
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

const MAX_CONTENT_LENGTH = 500_000;
const VALID_RELATIONSHIP_TYPES = new Set<string>(Object.values(RELATIONSHIP_TYPE));

// ─── Save agent source ────────────────────────────────────────────────────────

export async function saveAgentAction(
  agentId: string,
  params: {
    sourceContent: string;
    agentType?: AgentType | null;
    modelHint?: string | null;
    systemPrompt?: string | null;
    description?: string | null;
    tags?: string[];
    summary?: string | null;
  }
): Promise<ActionResult<{ id: string }>> {
  if (params.sourceContent.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: `Content exceeds maximum length (${MAX_CONTENT_LENGTH} bytes)` };
  }

  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const updated = await updateAgentContent(supabase, ctx.user.id, ctx.workspace.id, agentId, params);
    return { ok: true, data: { id: updated.id } };
  } catch (err) {
    console.error("[saveAgentAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save agent" };
  }
}

// ─── Create agent ─────────────────────────────────────────────────────────────

export async function createAgentInBoxAction(
  boxId: string,
  params: {
    name: string;
    canonicalFormat: SkillAgentFormat;
    agentType?: AgentType | null;
    modelHint?: string | null;
    systemPrompt?: string | null;
    description?: string | null;
    folderId?: string | null;
    initialContent?: string;
    isReusable?: boolean;
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

    const agent = await createAgent(supabase, ctx.user.id, ctx.workspace.id, {
      boxId,
      folderId: params.folderId ?? null,
      name: trimmedName,
      sourceContent: params.initialContent?.trim() ?? "",
      canonicalFormat: params.canonicalFormat,
      agentType: params.agentType ?? null,
      modelHint: params.modelHint?.trim() || null,
      systemPrompt: params.systemPrompt?.trim() || null,
      description: params.description?.trim() || null,
      isReusable: false,
    });

    // Materialize package-supporting defaults as real child files.
    // This keeps canonical source as the single editable source of truth while
    // still giving Agents concrete persisted internal structure.
    const readme = await createFile(supabase, ctx.user.id, ctx.workspace.id, {
      boxId,
      folderId: agent.folder_id ?? null,
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
      sourceObjectType: OBJECT_TYPE.AGENT,
      sourceObjectId: agent.id,
      targetObjectType: OBJECT_TYPE.FILE,
      targetObjectId: readme.id,
      relationshipType: RELATIONSHIP_TYPE.PARENT_OF,
      relationshipNote: "Agent README",
    });

    if (params.systemPrompt?.trim()) {
      const systemPromptFile = await createFile(supabase, ctx.user.id, ctx.workspace.id, {
        boxId,
        folderId: agent.folder_id ?? null,
        name: "SYSTEM_PROMPT",
        sourceContent: `${params.systemPrompt.trim()}\n`,
        canonicalFormat: "markdown",
        sourceLanguage: null,
        fileExtension: ".md",
        mimeType: "text/markdown",
      });
      await createLink(supabase, ctx.workspace.id, {
        sourceObjectType: OBJECT_TYPE.AGENT,
        sourceObjectId: agent.id,
        targetObjectType: OBJECT_TYPE.FILE,
        targetObjectId: systemPromptFile.id,
        relationshipType: RELATIONSHIP_TYPE.PARENT_OF,
        relationshipNote: "Agent system prompt",
      });
    }

    revalidatePath(`/app/boxes/${boxId}`);
    return { ok: true, data: { id: agent.id } };
  } catch (err) {
    console.error("[createAgentInBoxAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create agent" };
  }
}

export async function createReusableAgentAction(
  params: {
    name: string;
    canonicalFormat: SkillAgentFormat;
    agentType?: AgentType | null;
    modelHint?: string | null;
    systemPrompt?: string | null;
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

    const agent = await createAgent(supabase, ctx.user.id, ctx.workspace.id, {
      name: trimmedName,
      sourceContent: params.initialContent?.trim() ?? "",
      canonicalFormat: params.canonicalFormat,
      agentType: params.agentType ?? null,
      modelHint: params.modelHint?.trim() || null,
      systemPrompt: params.systemPrompt?.trim() || null,
      description: params.description?.trim() || null,
      isReusable: true,
    });

    revalidatePath("/app/agents");
    return { ok: true, data: { id: agent.id } };
  } catch (err) {
    console.error("[createReusableAgentAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create agent" };
  }
}

// ─── Update agent status ──────────────────────────────────────────────────────

export async function updateAgentStatusAction(
  agentId: string,
  status: "active" | "archived" | "trashed"
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const existing = await getAgentForWorkspace(supabase, agentId, ctx.workspace.id);
    if (!existing) return { ok: false, error: "Agent not found" };

    await updateAgent(supabase, agentId, { status });
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[updateAgentStatusAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update agent status" };
  }
}

// ─── Object links ─────────────────────────────────────────────────────────────

export async function createAgentObjectLinkAction(
  agentId: string,
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
      sourceObjectType: OBJECT_TYPE.AGENT,
      sourceObjectId: agentId,
      targetObjectType,
      targetObjectId,
      relationshipType,
      relationshipNote: relationshipNote ?? null,
    });

    return { ok: true, data: { id: link.id } };
  } catch (err) {
    console.error("[createAgentObjectLinkAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create link" };
  }
}

export async function deleteAgentObjectLinkAction(
  linkId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    await removeLink(supabase, ctx.workspace.id, linkId);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[deleteAgentObjectLinkAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete link" };
  }
}

export async function createAgentChildFolderAction(
  agentId: string,
  name: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const agent = await getAgentForWorkspace(supabase, agentId, ctx.workspace.id);
    if (!agent || !agent.box_id) return { ok: false, error: "Agent does not support children in this scope" };
    const folder = await createFolder(supabase, ctx.user.id, ctx.workspace.id, {
      boxId: agent.box_id,
      name: name.trim(),
      parentFolderId: agent.folder_id ?? null,
    });
    await createLink(supabase, ctx.workspace.id, {
      sourceObjectType: OBJECT_TYPE.AGENT,
      sourceObjectId: agentId,
      targetObjectType: OBJECT_TYPE.FOLDER,
      targetObjectId: folder.id,
      relationshipType: RELATIONSHIP_TYPE.PARENT_OF,
      relationshipNote: "Agent child folder",
    });
    revalidatePath(`/app/agents/${agentId}`);
    revalidatePath(`/app/boxes/${agent.box_id}`);
    return { ok: true, data: { id: folder.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create child folder" };
  }
}

export async function createAgentChildFileAction(
  agentId: string,
  params: {
    filename: string;
    canonicalFormat: SkillAgentFormat;
    initialContent?: string;
  }
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const agent = await getAgentForWorkspace(supabase, agentId, ctx.workspace.id);
    if (!agent || !agent.box_id) return { ok: false, error: "Agent does not support children in this scope" };
    const file = await createFile(supabase, ctx.user.id, ctx.workspace.id, {
      boxId: agent.box_id,
      folderId: agent.folder_id ?? null,
      name: params.filename.trim(),
      sourceContent: params.initialContent ?? "",
      canonicalFormat: params.canonicalFormat,
      sourceLanguage: null,
      fileExtension: null,
      mimeType: null,
    });
    await createLink(supabase, ctx.workspace.id, {
      sourceObjectType: OBJECT_TYPE.AGENT,
      sourceObjectId: agentId,
      targetObjectType: OBJECT_TYPE.FILE,
      targetObjectId: file.id,
      relationshipType: RELATIONSHIP_TYPE.PARENT_OF,
      relationshipNote: "Agent child file",
    });
    revalidatePath(`/app/agents/${agentId}`);
    revalidatePath(`/app/boxes/${agent.box_id}`);
    return { ok: true, data: { id: file.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create child file" };
  }
}

export async function attachSkillToAgentAction(
  agentId: string,
  skillId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const [agent, skill] = await Promise.all([
      getAgentForWorkspace(supabase, agentId, ctx.workspace.id),
      getSkillForWorkspace(supabase, skillId, ctx.workspace.id),
    ]);
    if (!agent) return { ok: false, error: "Agent not found" };
    if (!skill) return { ok: false, error: "Skill not found" };
    const link = await createLink(supabase, ctx.workspace.id, {
      sourceObjectType: OBJECT_TYPE.AGENT,
      sourceObjectId: agentId,
      targetObjectType: OBJECT_TYPE.SKILL,
      targetObjectId: skillId,
      relationshipType: RELATIONSHIP_TYPE.DEPENDS_ON,
      relationshipNote: "Agent skill dependency",
    });
    revalidatePath(`/app/agents/${agentId}`);
    return { ok: true, data: { id: link.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to attach skill" };
  }
}
