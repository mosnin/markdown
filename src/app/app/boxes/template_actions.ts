"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  createTemplate,
  createTemplateFromNote,
  updateTemplate,
  deleteTemplate,
  type UpdateTemplatePatch,
} from "@/server/services/note_template_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireWriteContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  if (ctx.workspace.role === "viewer") {
    throw new Error("Viewers cannot perform write actions in this workspace.");
  }
  const supabase = await createClient();
  return {
    supabase,
    userId: ctx.user.id,
    workspaceId: ctx.workspace.id,
  };
}

// ─── Template actions ────────────────────────────────────────────────────────

export async function createTemplateAction(
  boxId: string,
  name: string,
  description?: string | null,
  markdownContent?: string,
  tags?: string[]
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireWriteContext();
    const template = await createTemplate(supabase, {
      boxId,
      workspaceId,
      name,
      description,
      markdownContent,
      tags,
      createdBy: userId,
    });
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "note_template",
      object_id: template.id,
      event_type: "template.created",
      metadata: { name: template.name, box_id: boxId },
    });
    revalidatePath(`/app/boxes/${boxId}/templates`);
    return { ok: true, data: { id: template.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create template",
    };
  }
}

export async function createTemplateFromNoteAction(
  noteId: string,
  name?: string,
  description?: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireWriteContext();
    const template = await createTemplateFromNote(supabase, noteId, {
      name,
      description,
    });
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "note_template",
      object_id: template.id,
      event_type: "template.created",
      metadata: { name: template.name, box_id: template.box_id, from_note_id: noteId },
    });
    revalidatePath(`/app/boxes/${template.box_id}/templates`);
    return { ok: true, data: { id: template.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create template from note",
    };
  }
}

export async function updateTemplateAction(
  templateId: string,
  patch: UpdateTemplatePatch
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireWriteContext();
    const updated = await updateTemplate(supabase, templateId, patch);
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "note_template",
      object_id: templateId,
      event_type: "template.updated",
      metadata: { name: updated.name, box_id: updated.box_id },
    });
    revalidatePath(`/app/boxes/${updated.box_id}/templates`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update template",
    };
  }
}

export async function deleteTemplateAction(
  templateId: string,
  boxId: string
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireWriteContext();
    await deleteTemplate(supabase, templateId);
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId,
      object_type: "note_template",
      object_id: templateId,
      event_type: "template.deleted",
      metadata: { box_id: boxId },
    });
    revalidatePath(`/app/boxes/${boxId}/templates`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete template",
    };
  }
}
