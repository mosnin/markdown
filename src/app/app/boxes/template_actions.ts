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
    const { supabase } = await requireWriteContext();
    const template = await createTemplateFromNote(supabase, noteId, {
      name,
      description,
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
    const { supabase } = await requireWriteContext();
    const updated = await updateTemplate(supabase, templateId, patch);
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
    const { supabase } = await requireWriteContext();
    await deleteTemplate(supabase, templateId);
    revalidatePath(`/app/boxes/${boxId}/templates`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete template",
    };
  }
}
