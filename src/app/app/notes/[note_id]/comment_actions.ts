"use server";

import { revalidatePath } from "next/cache";
import { requireWriteRoleResult } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import {
  createNoteComment,
  resolveComment,
  unresolveComment,
  deleteComment,
} from "@/server/services/note_comment_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Create a new comment (or reply) on a note.
 */
export async function createNoteCommentAction(
  noteId: string,
  body: string,
  parentCommentId?: string | null
): Promise<ActionResult> {
  const auth = await requireWriteRoleResult();
  if (!auth.ok) return { success: false, error: auth.error };
  const { ctx } = auth;

  try {
    const supabase = await createClient();
    const comment = await createNoteComment(supabase, {
      noteId,
      workspaceId: ctx.workspace.id,
      authorId: ctx.user.id,
      body,
      parentCommentId,
    });
    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "note_comment",
      object_id: comment.id,
      event_type: "note.comment.created",
      metadata: { note_id: noteId },
    });
    revalidatePath(`/app/notes/${noteId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create comment",
    };
  }
}

/**
 * Resolve a comment thread.
 */
export async function resolveNoteCommentAction(
  noteId: string,
  commentId: string
): Promise<ActionResult> {
  const auth = await requireWriteRoleResult();
  if (!auth.ok) return { success: false, error: auth.error };
  const { ctx } = auth;

  try {
    const supabase = await createClient();
    await resolveComment(supabase, commentId, ctx.user.id);
    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "note_comment",
      object_id: commentId,
      event_type: "note.comment.resolved",
      metadata: { note_id: noteId },
    });
    revalidatePath(`/app/notes/${noteId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to resolve comment",
    };
  }
}

/**
 * Unresolve a previously resolved comment thread.
 */
export async function unresolveNoteCommentAction(
  noteId: string,
  commentId: string
): Promise<ActionResult> {
  const auth = await requireWriteRoleResult();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const supabase = await createClient();
    await unresolveComment(supabase, commentId);
    revalidatePath(`/app/notes/${noteId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to unresolve comment",
    };
  }
}

/**
 * Delete a comment. Only the comment author can delete.
 */
export async function deleteNoteCommentAction(
  noteId: string,
  commentId: string
): Promise<ActionResult> {
  const auth = await requireWriteRoleResult();
  if (!auth.ok) return { success: false, error: auth.error };
  const { ctx } = auth;

  try {
    const supabase = await createClient();
    await deleteComment(supabase, commentId, ctx.user.id);
    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "note_comment",
      object_id: commentId,
      event_type: "note.comment.deleted",
      metadata: { note_id: noteId },
    });
    revalidatePath(`/app/notes/${noteId}`);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete comment",
    };
  }
}
