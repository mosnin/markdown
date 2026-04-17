import { type SupabaseClient } from "@supabase/supabase-js";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

/**
 * Branch review workflow.
 *
 * A lightweight review gate for draft branches. The author requests
 * review; reviewers approve or request changes; `promoteBranch`
 * refuses to land a branch whose `review_status` isn't 'draft' or
 * 'approved'. That gate lives in `branch_service.promoteBranch`; this
 * service is the write surface that flips the status.
 *
 * State machine on `draft_branches.review_status`:
 *
 *     draft ──request──▶ review_requested
 *     review_requested ──approve──▶ approved
 *     review_requested ──reject──▶ changes_requested
 *     changes_requested ──reset──▶ review_requested (after re-request)
 *     approved ──reset──▶ draft (after author pushes more work)
 *
 * Individual review rows (`branch_reviews`) are append-only from the
 * user's perspective: a later review from the same reviewer stamps
 * `superseded_at` on their earlier row rather than mutating it. The
 * partial index `branch_reviews_branch_idx WHERE superseded_at IS
 * NULL` is what callers read against.
 *
 * Self-approve is rejected: a user cannot submit a review on a branch
 * they themselves created. The branch's `created_by` is the
 * authority.
 */

export type BranchReviewStatus =
  | "draft"
  | "review_requested"
  | "approved"
  | "changes_requested";

export type BranchReviewDecision = "approved" | "changes_requested";

export interface BranchReview {
  id: string;
  branch_id: string;
  reviewer_id: string;
  decision: BranchReviewDecision;
  note: string | null;
  created_at: string;
  superseded_at: string | null;
}

export interface BranchReviewWithReviewer extends BranchReview {
  reviewer_display_name: string | null;
  reviewer_email: string | null;
}

interface DraftBranchRow {
  id: string;
  workspace_id: string;
  created_by: string | null;
  review_status: BranchReviewStatus;
}

async function loadBranch(
  supabase: SupabaseClient,
  branchId: string
): Promise<DraftBranchRow> {
  const { data, error } = await supabase
    .from("draft_branches")
    .select("id, workspace_id, created_by, review_status")
    .eq("id", branchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Branch not found");
  return data as DraftBranchRow;
}

// ─── Request review ──────────────────────────────────────────────────────────

/**
 * Flip a branch into `review_requested`. Valid from any state except
 * `approved` (you can't request a second review on something already
 * approved; use `resetReview` first after pushing fresh changes).
 */
export async function requestReview(
  supabase: SupabaseClient,
  branchId: string,
  actorId: string
): Promise<{ branchId: string; reviewStatus: BranchReviewStatus }> {
  const branch = await loadBranch(supabase, branchId);
  if (branch.review_status === "approved") {
    throw new Error(
      "Branch is already approved. Reset the review before requesting again."
    );
  }

  const { error } = await supabase
    .from("draft_branches")
    .update({ review_status: "review_requested" })
    .eq("id", branchId);
  if (error) throw new Error(error.message);

  await createAuditEvent(supabase, {
    workspace_id: branch.workspace_id,
    actor_type: "user",
    actor_id: actorId,
    object_type: "draft_branch",
    object_id: branchId,
    event_type: "branch.review_requested",
    metadata: { previous_status: branch.review_status },
  });

  return { branchId, reviewStatus: "review_requested" };
}

// ─── Submit review ───────────────────────────────────────────────────────────

/**
 * Record a reviewer's decision. Any prior non-superseded reviews by
 * the same reviewer are stamped `superseded_at = now()` so the active
 * review list shows one row per reviewer.
 *
 * Status transition:
 *   - approved    → draft_branches.review_status = 'approved'
 *                   (one approval is enough to gate; additional
 *                    approvals don't weaken this)
 *   - changes_requested → draft_branches.review_status =
 *                    'changes_requested'
 *
 * Self-approve is rejected: `reviewer_id` cannot equal
 * `branch.created_by`.
 */
export async function submitReview(
  supabase: SupabaseClient,
  branchId: string,
  reviewerId: string,
  decision: BranchReviewDecision,
  note?: string | null
): Promise<{ review: BranchReview; reviewStatus: BranchReviewStatus }> {
  const branch = await loadBranch(supabase, branchId);
  if (branch.created_by && branch.created_by === reviewerId) {
    throw new Error("Authors cannot review their own branch");
  }

  const nowIso = new Date().toISOString();

  // Mark any prior non-superseded rows by this reviewer as superseded.
  const { error: supersedeErr } = await supabase
    .from("branch_reviews")
    .update({ superseded_at: nowIso })
    .eq("branch_id", branchId)
    .eq("reviewer_id", reviewerId)
    .is("superseded_at", null);
  if (supersedeErr) throw new Error(supersedeErr.message);

  const { data: inserted, error: insertErr } = await supabase
    .from("branch_reviews")
    .insert({
      branch_id: branchId,
      reviewer_id: reviewerId,
      decision,
      note: note ?? null,
    })
    .select("*")
    .single();
  if (insertErr || !inserted) {
    throw new Error(insertErr?.message ?? "Failed to record review");
  }

  // Compute the new branch-level status. An approval always wins if
  // no one has requested changes since; a changes_requested always
  // wins until a later approval arrives.
  const nextStatus: BranchReviewStatus =
    decision === "approved" ? "approved" : "changes_requested";

  const { error: statusErr } = await supabase
    .from("draft_branches")
    .update({ review_status: nextStatus })
    .eq("id", branchId);
  if (statusErr) throw new Error(statusErr.message);

  await createAuditEvent(supabase, {
    workspace_id: branch.workspace_id,
    actor_type: "user",
    actor_id: reviewerId,
    object_type: "draft_branch",
    object_id: branchId,
    event_type:
      decision === "approved"
        ? "branch.review_approved"
        : "branch.review_changes_requested",
    metadata: {
      review_id: (inserted as { id: string }).id,
      previous_status: branch.review_status,
      new_status: nextStatus,
    },
  });

  return {
    review: inserted as BranchReview,
    reviewStatus: nextStatus,
  };
}

// ─── List reviews ────────────────────────────────────────────────────────────

/**
 * Return every non-superseded review for the branch. Reviewer
 * display info is left as null here — the UI resolves names via the
 * auth layer it already has loaded, and attaching a cross-schema
 * join against `auth.users` through PostgREST is intentionally
 * avoided. Callers that need a name render the reviewer_id and the
 * request context's list of workspace members, same as the audit
 * view service.
 */
export async function listReviews(
  supabase: SupabaseClient,
  branchId: string
): Promise<BranchReviewWithReviewer[]> {
  const { data: reviews, error } = await supabase
    .from("branch_reviews")
    .select("*")
    .eq("branch_id", branchId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (reviews ?? []) as BranchReview[];
  if (rows.length === 0) return [];

  return rows.map((r) => ({
    ...r,
    reviewer_display_name: null,
    reviewer_email: null,
  }));
}

// ─── Reset after author edits ────────────────────────────────────────────────

/**
 * Called when the author pushes new changes to a branch after review
 * has already happened. Marks all prior reviews `superseded_at = now()`
 * and rolls `review_status` back.
 *
 * Target state:
 *   - If any non-superseded review existed at call time (i.e. the
 *     author is explicitly re-opening review), we flip to
 *     `review_requested` so the UI reminds reviewers to take another
 *     look.
 *   - If no reviews existed (author reset proactively before any
 *     review happened), we drop back to `draft`.
 *
 * TODO (noted in spec): wire this up inside write hooks so it fires
 * automatically on branch edits. For now it's exposed as an explicit
 * action.
 */
export async function resetReview(
  supabase: SupabaseClient,
  branchId: string,
  actorId: string
): Promise<{ reviewStatus: BranchReviewStatus }> {
  const branch = await loadBranch(supabase, branchId);

  // Count pending reviews before stamping so we know which state to
  // land in.
  const { data: pendingRows, error: countErr } = await supabase
    .from("branch_reviews")
    .select("id")
    .eq("branch_id", branchId)
    .is("superseded_at", null);
  if (countErr) throw new Error(countErr.message);
  const pendingCount = (pendingRows ?? []).length;

  const nowIso = new Date().toISOString();
  const { error: supersedeErr } = await supabase
    .from("branch_reviews")
    .update({ superseded_at: nowIso })
    .eq("branch_id", branchId)
    .is("superseded_at", null);
  if (supersedeErr) throw new Error(supersedeErr.message);

  const nextStatus: BranchReviewStatus =
    pendingCount > 0 ? "review_requested" : "draft";

  const { error: statusErr } = await supabase
    .from("draft_branches")
    .update({ review_status: nextStatus })
    .eq("id", branchId);
  if (statusErr) throw new Error(statusErr.message);

  await createAuditEvent(supabase, {
    workspace_id: branch.workspace_id,
    actor_type: "user",
    actor_id: actorId,
    object_type: "draft_branch",
    object_id: branchId,
    event_type: "branch.review_reset",
    metadata: {
      previous_status: branch.review_status,
      new_status: nextStatus,
      superseded_count: pendingCount,
    },
  });

  return { reviewStatus: nextStatus };
}
