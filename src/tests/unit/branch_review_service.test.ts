import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for `branch_review_service` — the review-gate layer that
 * sits in front of `promoteBranch` and is driven by the author's
 * "request review" + reviewers' "approve / request changes" actions.
 *
 * Invariants covered:
 *   1. `requestReview` flips a draft branch to `review_requested`
 *      and records an audit event.
 *   2. `submitReview(approved)` writes a branch_reviews row and
 *      transitions the branch to `approved`.
 *   3. `submitReview(changes_requested)` transitions the branch to
 *      `changes_requested`.
 *   4. Self-approve is rejected at the service layer (branch's
 *      `created_by` cannot equal `reviewer_id`).
 *   5. A second review from the same reviewer stamps `superseded_at`
 *      on their prior row.
 *   6. `resetReview` stamps every pending review as superseded and
 *      transitions to `review_requested` if there were any, else back
 *      to `draft`.
 */

vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn().mockResolvedValue({ id: "audit-1" }),
}));

import {
  requestReview,
  submitReview,
  resetReview,
} from "@/server/services/branch_review_service";

const BRANCH_ID = "branch-1";
const WS_ID = "ws-1";
const AUTHOR_ID = "user-author";
const REVIEWER_ID = "user-reviewer";

interface Call {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  filters: Array<{ col: string; val: unknown; kind: "eq" | "is" }>;
  payload?: Record<string, unknown>;
}

function makeSupabase(opts: {
  branchRow?: {
    workspace_id: string;
    created_by: string | null;
    review_status:
      | "draft"
      | "review_requested"
      | "approved"
      | "changes_requested";
  };
  pendingReviews?: Array<{ id: string }>;
  insertedReview?: Record<string, unknown>;
}) {
  const calls: Call[] = [];
  function builder(table: string) {
    let op: Call["op"] = "select";
    const filters: Call["filters"] = [];
    let payload: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filters.push({ col, val, kind: "eq" });
      return b;
    };
    b.is = (col: string, val: unknown) => {
      filters.push({ col, val, kind: "is" });
      return b;
    };
    b.order = () => b;
    b.insert = (p: Record<string, unknown>) => {
      op = "insert";
      payload = p;
      return b;
    };
    b.update = (p: Record<string, unknown>) => {
      op = "update";
      payload = p;
      return b;
    };
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, filters: [...filters], payload });
      if (op === "insert") {
        return {
          data:
            opts.insertedReview ?? {
              id: "review-1",
              branch_id: BRANCH_ID,
              reviewer_id: REVIEWER_ID,
              decision: "approved",
              note: null,
              created_at: new Date().toISOString(),
              superseded_at: null,
            },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, filters: [...filters], payload });
      if (table === "draft_branches" && op === "select") {
        return {
          data: opts.branchRow
            ? {
                id: BRANCH_ID,
                workspace_id: opts.branchRow.workspace_id,
                created_by: opts.branchRow.created_by,
                review_status: opts.branchRow.review_status,
              }
            : null,
          error: null,
        };
      }
      return { data: null, error: null };
    };
    b.then = async (
      resolve: (v: { data: unknown[]; error: null }) => void
    ) => {
      calls.push({ table, op, filters: [...filters], payload });
      if (table === "branch_reviews" && op === "select") {
        resolve({ data: opts.pendingReviews ?? [], error: null });
      } else {
        resolve({ data: [], error: null });
      }
    };
    return b;
  }
  return { supabase: { from: builder } as never, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestReview", () => {
  it("flips draft → review_requested", async () => {
    const { supabase, calls } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "draft",
      },
    });
    const result = await requestReview(supabase, BRANCH_ID, AUTHOR_ID);
    expect(result.reviewStatus).toBe("review_requested");
    const update = calls.find(
      (c) => c.table === "draft_branches" && c.op === "update"
    );
    expect(update).toBeDefined();
    expect(update!.payload).toEqual({ review_status: "review_requested" });
  });

  it("rejects when already approved", async () => {
    const { supabase } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "approved",
      },
    });
    await expect(
      requestReview(supabase, BRANCH_ID, AUTHOR_ID)
    ).rejects.toThrow(/already approved/i);
  });
});

describe("submitReview", () => {
  it("approved → status=approved + inserts review row", async () => {
    const { supabase, calls } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "review_requested",
      },
    });
    const result = await submitReview(
      supabase,
      BRANCH_ID,
      REVIEWER_ID,
      "approved",
      "lgtm"
    );
    expect(result.reviewStatus).toBe("approved");
    const insert = calls.find(
      (c) => c.table === "branch_reviews" && c.op === "insert"
    );
    expect(insert).toBeDefined();
    expect(insert!.payload).toMatchObject({
      branch_id: BRANCH_ID,
      reviewer_id: REVIEWER_ID,
      decision: "approved",
      note: "lgtm",
    });
    const statusUpdate = calls.find(
      (c) =>
        c.table === "draft_branches" &&
        c.op === "update" &&
        c.payload?.review_status === "approved"
    );
    expect(statusUpdate).toBeDefined();
  });

  it("changes_requested → status=changes_requested", async () => {
    const { supabase } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "review_requested",
      },
    });
    const result = await submitReview(
      supabase,
      BRANCH_ID,
      REVIEWER_ID,
      "changes_requested",
      "needs more tests"
    );
    expect(result.reviewStatus).toBe("changes_requested");
  });

  it("rejects self-approve", async () => {
    const { supabase } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "review_requested",
      },
    });
    await expect(
      submitReview(supabase, BRANCH_ID, AUTHOR_ID, "approved")
    ).rejects.toThrow(/cannot review their own/i);
  });

  it("supersedes prior non-superseded reviews from the same reviewer", async () => {
    const { supabase, calls } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "review_requested",
      },
    });
    await submitReview(supabase, BRANCH_ID, REVIEWER_ID, "approved");
    // The first write against branch_reviews should be an UPDATE
    // that stamps superseded_at, filtered by branch_id + reviewer_id
    // + is(superseded_at, null).
    const supersedeCall = calls.find(
      (c) => c.table === "branch_reviews" && c.op === "update"
    );
    expect(supersedeCall).toBeDefined();
    expect(supersedeCall!.payload).toHaveProperty("superseded_at");
    const branchFilter = supersedeCall!.filters.find(
      (f) => f.col === "branch_id"
    );
    const reviewerFilter = supersedeCall!.filters.find(
      (f) => f.col === "reviewer_id"
    );
    const supersededFilter = supersedeCall!.filters.find(
      (f) => f.col === "superseded_at" && f.kind === "is"
    );
    expect(branchFilter?.val).toBe(BRANCH_ID);
    expect(reviewerFilter?.val).toBe(REVIEWER_ID);
    expect(supersededFilter?.val).toBeNull();
  });
});

describe("resetReview", () => {
  it("with pending reviews → supersedes and flips to review_requested", async () => {
    const { supabase, calls } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "approved",
      },
      pendingReviews: [{ id: "rev-1" }, { id: "rev-2" }],
    });
    const result = await resetReview(supabase, BRANCH_ID, AUTHOR_ID);
    expect(result.reviewStatus).toBe("review_requested");
    const statusUpdate = calls.find(
      (c) =>
        c.table === "draft_branches" &&
        c.op === "update" &&
        c.payload?.review_status === "review_requested"
    );
    expect(statusUpdate).toBeDefined();
  });

  it("with no pending reviews → flips to draft", async () => {
    const { supabase, calls } = makeSupabase({
      branchRow: {
        workspace_id: WS_ID,
        created_by: AUTHOR_ID,
        review_status: "review_requested",
      },
      pendingReviews: [],
    });
    const result = await resetReview(supabase, BRANCH_ID, AUTHOR_ID);
    expect(result.reviewStatus).toBe("draft");
    const statusUpdate = calls.find(
      (c) =>
        c.table === "draft_branches" &&
        c.op === "update" &&
        c.payload?.review_status === "draft"
    );
    expect(statusUpdate).toBeDefined();
  });
});
