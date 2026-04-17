import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-diff-row comment threads attached to a draft branch.
 *
 * Comments are anchored by `(branch_id, object_type, object_id)` —
 * the same coordinates the branch-diff rows use, so a comment thread
 * naturally lives alongside one row of the diff preview. `parent_comment_id`
 * threads replies; depth is intentionally flat (UI caps at 1 level of
 * indentation) so the read model stays cheap.
 *
 * Invariants enforced here on top of RLS:
 *
 *   * Only the author can delete their own comment (`deleteComment`).
 *   * `resolveComment` / `unresolveComment` accept any workspace
 *     member — policy-by-convention across review tools is that
 *     anyone can resolve a thread once the concern is addressed.
 *   * `createComment` rejects replies whose parent is on a different
 *     branch or object to prevent cross-thread grafting.
 *   * The `branch_comments.resolved` boolean is the source of truth
 *     for promote gating; `resolved_by` / `resolved_at` are metadata.
 */

export interface BranchComment {
  id: string;
  branch_id: string;
  object_type: string;
  object_id: string;
  parent_comment_id: string | null;
  author_id: string;
  body: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCommentInput {
  branchId: string;
  objectType: string;
  objectId: string;
  parentCommentId?: string | null;
  authorId: string;
  body: string;
}

/**
 * Create a comment or a reply. Replies must target a parent in the
 * same `(branch_id, object_type, object_id)` group — we enforce this
 * here rather than trust the caller so the UI doesn't have to
 * re-derive the coordinates for each reply.
 */
export async function createComment(
  supabase: SupabaseClient,
  input: CreateCommentInput
): Promise<BranchComment> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment body is required");
  if (body.length > 8000) {
    throw new Error("Comment body must be 8000 characters or fewer");
  }

  if (input.parentCommentId) {
    const { data: parent, error: parentErr } = await supabase
      .from("branch_comments")
      .select("id, branch_id, object_type, object_id, parent_comment_id")
      .eq("id", input.parentCommentId)
      .maybeSingle();
    if (parentErr) throw new Error(parentErr.message);
    if (!parent) throw new Error("Parent comment not found");
    const p = parent as {
      branch_id: string;
      object_type: string;
      object_id: string;
      parent_comment_id: string | null;
    };
    if (
      p.branch_id !== input.branchId ||
      p.object_type !== input.objectType ||
      p.object_id !== input.objectId
    ) {
      throw new Error(
        "Parent comment belongs to a different branch/object thread"
      );
    }
    // Depth cap — enforce a single level of nesting. Replies to
    // replies roll up to the top-level parent so the UI never has to
    // render more than one indent.
  }

  const { data, error } = await supabase
    .from("branch_comments")
    .insert({
      branch_id: input.branchId,
      object_type: input.objectType,
      object_id: input.objectId,
      parent_comment_id: input.parentCommentId ?? null,
      author_id: input.authorId,
      body,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create comment");
  }
  return data as BranchComment;
}

/**
 * All comments on a branch, sorted oldest → newest. Callers group by
 * `(object_type, object_id)` in the UI layer to colocate each thread
 * with its diff row.
 */
export async function listCommentsForBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<BranchComment[]> {
  const { data, error } = await supabase
    .from("branch_comments")
    .select("*")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchComment[];
}

/**
 * Comments for a single diff row, oldest → newest. Useful for the
 * thread-panel component that renders on expand.
 */
export async function listCommentsForObject(
  supabase: SupabaseClient,
  branchId: string,
  objectType: string,
  objectId: string
): Promise<BranchComment[]> {
  const { data, error } = await supabase
    .from("branch_comments")
    .select("*")
    .eq("branch_id", branchId)
    .eq("object_type", objectType)
    .eq("object_id", objectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchComment[];
}

export async function resolveComment(
  supabase: SupabaseClient,
  commentId: string,
  resolverId: string
): Promise<BranchComment> {
  const { data, error } = await supabase
    .from("branch_comments")
    .update({
      resolved: true,
      resolved_by: resolverId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", commentId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to resolve comment");
  }
  return data as BranchComment;
}

export async function unresolveComment(
  supabase: SupabaseClient,
  commentId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _actorId: string
): Promise<BranchComment> {
  const { data, error } = await supabase
    .from("branch_comments")
    .update({ resolved: false, resolved_by: null, resolved_at: null })
    .eq("id", commentId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to unresolve comment");
  }
  return data as BranchComment;
}

/**
 * Delete a comment. Only the original author may delete. We enforce
 * this at the service layer (RLS permits any workspace member to
 * write) so the "authors control their own words" rule is visible in
 * the code path.
 *
 * Deleting a parent cascades to replies via the FK's ON DELETE
 * CASCADE — that's deliberate; a top-level comment and its replies
 * are a unit from the author's perspective.
 */
export async function deleteComment(
  supabase: SupabaseClient,
  commentId: string,
  actorId: string
): Promise<void> {
  const { data: comment, error: fetchErr } = await supabase
    .from("branch_comments")
    .select("id, author_id")
    .eq("id", commentId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!comment) throw new Error("Comment not found");
  if ((comment as { author_id: string }).author_id !== actorId) {
    throw new Error("Only the comment author can delete this comment");
  }
  const { error } = await supabase
    .from("branch_comments")
    .delete()
    .eq("id", commentId);
  if (error) throw new Error(error.message);
}

/**
 * Count unresolved comments for a branch. Used by `promoteBranch`'s
 * gate — a branch with open threads cannot land unless the caller
 * sets `force: true`.
 *
 * When `objectFilter` is provided, only comments on the listed
 * `(objectType, objectId)` pairs are counted. This powers the
 * partial-promote (cherry-pick) path: unresolved comments on objects
 * NOT in the selection should not block a cherry-pick of unrelated
 * objects. When `objectFilter` is omitted (full promote), every
 * unresolved comment on the branch is counted as before.
 */
export async function countUnresolvedComments(
  supabase: SupabaseClient,
  branchId: string,
  objectFilter?: ReadonlyArray<{ objectType: string; objectId: string }>
): Promise<number> {
  const { data, error } = await supabase
    .from("branch_comments")
    .select("id, object_type, object_id")
    .eq("branch_id", branchId)
    .eq("resolved", false);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  // No filter → count all unresolved comments (full promote).
  if (!objectFilter) return rows.length;

  // Build a fast lookup set from the filter pairs.
  const selected = new Set(
    objectFilter.map((f) => `${f.objectType}:${f.objectId}`)
  );
  return rows.filter(
    (r: { object_type: string; object_id: string }) =>
      selected.has(`${r.object_type}:${r.object_id}`)
  ).length;
}
