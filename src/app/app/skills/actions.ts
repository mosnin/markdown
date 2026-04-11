"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createSkill } from "@/server/services/skill_service";
import { getBoxById } from "@/server/repositories/box_repository";
import { createLink, removeLink } from "@/server/services/object_link_service";
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
