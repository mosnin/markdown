import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Note-level discussion threads.
 *
 * Lightweight comments directly on a note — no branch or proposal
 * required. `parent_comment_id` threads replies; depth is
 * intentionally flat (UI caps at 1 level of indentation) so the read
 * model stays cheap.
 *
 * Invariants enforced here on top of RLS:
 *
 *   * Only the author can delete their own comment (`deleteComment`).
 *   * `resolveComment` / `unresolveComment` accept any workspace
 *     member — convention is that anyone can resolve a thread once
 *     the concern is addressed.
 *   * `createNoteComment` rejects replies whose parent is on a
 *     different note to prevent cross-thread grafting.
 */

export interface NoteComment {
  id: string;
  note_id: string;
  workspace_id: string;
  parent_comment_id: string | null;
  author_id: string;
  body: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNoteCommentInput {
  noteId: string;
  workspaceId: string;
  authorId: string;
  body: string;
  parentCommentId?: string | null;
}

/**
 * Threaded comment list: top-level comments with their children
 * nested under `replies`.
 */
export interface ThreadedComment extends NoteComment {
  replies: NoteComment[];
}

/**
 * Create a comment or a reply on a note. Replies must target a
 * parent on the same note — we enforce this here rather than trust
 * the caller.
 */
export async function createNoteComment(
  supabase: SupabaseClient,
  input: CreateNoteCommentInput
): Promise<NoteComment> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment body is required");
  if (body.length > 8000) {
    throw new Error("Comment body must be 8000 characters or fewer");
  }

  // Verify the note belongs to the workspace
  const { data: noteRow, error: noteErr } = await supabase
    .from("notes")
    .select("id")
    .eq("id", input.noteId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (noteErr) throw new Error(noteErr.message);
  if (!noteRow) throw new Error("Note does not belong to this workspace");

  if (input.parentCommentId) {
    const { data: parent, error: parentErr } = await supabase
      .from("note_comments")
      .select("id, note_id, parent_comment_id")
      .eq("id", input.parentCommentId)
      .maybeSingle();
    if (parentErr) throw new Error(parentErr.message);
    if (!parent) throw new Error("Parent comment not found");
    const p = parent as { note_id: string; parent_comment_id: string | null };
    if (p.note_id !== input.noteId) {
      throw new Error(
        "Parent comment belongs to a different note"
      );
    }
  }

  const { data, error } = await supabase
    .from("note_comments")
    .insert({
      note_id: input.noteId,
      workspace_id: input.workspaceId,
      parent_comment_id: input.parentCommentId ?? null,
      author_id: input.authorId,
      body,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create comment");
  }
  return data as NoteComment;
}

/**
 * All comments on a note, returned as threaded groups (parent +
 * children). Top-level comments are sorted oldest → newest; replies
 * are sorted oldest → newest within each thread.
 */
export async function listNoteComments(
  supabase: SupabaseClient,
  noteId: string
): Promise<ThreadedComment[]> {
  const { data, error } = await supabase
    .from("note_comments")
    .select("*")
    .eq("note_id", noteId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as NoteComment[];

  // Group into threads: top-level (parent_comment_id is null) with
  // replies nested underneath.
  const topLevel: ThreadedComment[] = [];
  const childMap = new Map<string, NoteComment[]>();

  for (const row of rows) {
    if (row.parent_comment_id) {
      const siblings = childMap.get(row.parent_comment_id) ?? [];
      siblings.push(row);
      childMap.set(row.parent_comment_id, siblings);
    } else {
      topLevel.push({ ...row, replies: [] });
    }
  }

  for (const thread of topLevel) {
    thread.replies = childMap.get(thread.id) ?? [];
  }

  return topLevel;
}

/**
 * Resolve a comment thread. Any workspace member can resolve.
 */
export async function resolveComment(
  supabase: SupabaseClient,
  commentId: string,
  resolvedBy: string
): Promise<NoteComment> {
  const { data, error } = await supabase
    .from("note_comments")
    .update({
      resolved: true,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", commentId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to resolve comment");
  }
  return data as NoteComment;
}

/**
 * Unresolve a previously resolved comment thread.
 */
export async function unresolveComment(
  supabase: SupabaseClient,
  commentId: string
): Promise<NoteComment> {
  const { data, error } = await supabase
    .from("note_comments")
    .update({ resolved: false, resolved_by: null, resolved_at: null })
    .eq("id", commentId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to unresolve comment");
  }
  return data as NoteComment;
}

/**
 * Delete a comment. Only the original author may delete.
 * Deleting a parent cascades to replies via the FK's ON DELETE
 * CASCADE.
 */
export async function deleteComment(
  supabase: SupabaseClient,
  commentId: string,
  actorId: string
): Promise<void> {
  const { data: comment, error: fetchErr } = await supabase
    .from("note_comments")
    .select("id, author_id")
    .eq("id", commentId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!comment) throw new Error("Comment not found");
  if ((comment as { author_id: string }).author_id !== actorId) {
    throw new Error("Only the comment author can delete this comment");
  }
  const { error } = await supabase
    .from("note_comments")
    .delete()
    .eq("id", commentId);
  if (error) throw new Error(error.message);
}

/**
 * Count unresolved top-level comments on a note. Useful for badge
 * counts in the UI.
 */
export async function countUnresolvedComments(
  supabase: SupabaseClient,
  noteId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("note_comments")
    .select("id")
    .eq("note_id", noteId)
    .eq("resolved", false)
    .is("parent_comment_id", null);
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
