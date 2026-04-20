import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dispatchOperatorExecute } from "@/server/services/workspace_operator_service";

/**
 * Plan-edit round-trip — Operator panel → action → service → Modal POST body.
 *
 * The panel collects post-edit step descriptions, the action forwards them as
 * `approvedPlan`, and `dispatchOperatorExecute` puts them on the wire as
 * `approved_plan`. This test asserts the *exact* edited description bytes
 * survive the service-level serialization step so the Python agent sees the
 * user's overrides verbatim, not the planner's original text.
 */

const enabledEnv = {
  WORKSPACE_OPERATOR_ENABLED: "true",
  WORKSPACE_OPERATOR_URL: "https://modal.test/invoke",
  WORKSPACE_OPERATOR_SHARED_SECRET: "dispatcher-secret-abcdefgh12345",
};

const baseInput = {
  runId: "dispatcher-run-edit-0001",
  userId: "00000000-0000-0000-0000-000000000001",
  workspaceId: "11111111-1111-1111-1111-111111111111",
  branchId: "22222222-2222-2222-2222-222222222222",
  boxId: "33333333-3333-3333-3333-333333333333",
  prompt: "Draft a brief on our Q1 roadmap",
};

const editedSteps = [
  {
    index: 0,
    description: "USER-EDITED: search the EU competitive landscape only",
    tool: "hybrid_search",
  },
  {
    index: 1,
    description: "USER-EDITED: draft a one-page customer-facing brief",
    tool: "draft_note",
  },
];

const originalEnv = { ...process.env };

function okExecuteResponse() {
  return new Response(
    JSON.stringify({
      run_id: baseInput.runId,
      status: "completed",
      notes_created: ["note-x"],
      tool_calls: 2,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("dispatchOperatorExecute — edited plan steps round-trip", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ...enabledEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("includes the edited step descriptions verbatim in the outbound POST body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okExecuteResponse());

    await dispatchOperatorExecute(
      { ...baseInput, approvedPlan: editedSteps },
      fetchMock as unknown as typeof fetch
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string);

    expect(body.mode).toBe("execute");
    expect(Array.isArray(body.approved_plan)).toBe(true);
    expect(body.approved_plan).toHaveLength(2);

    // Exact-bytes assertion — the descriptions the user edited must reach
    // the Python agent unaltered (no truncation, no re-ordering, no
    // accidental fallback to the planner's original text).
    expect(body.approved_plan[0]).toEqual({
      index: 0,
      description: "USER-EDITED: search the EU competitive landscape only",
      tool: "hybrid_search",
    });
    expect(body.approved_plan[1]).toEqual({
      index: 1,
      description: "USER-EDITED: draft a one-page customer-facing brief",
      tool: "draft_note",
    });
  });

  it("preserves the order of edited steps in the POST body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okExecuteResponse());

    // Intentionally hand the dispatcher steps in non-monotonic index order
    // to confirm we forward the array as-is rather than re-sorting.
    const reordered = [editedSteps[1], editedSteps[0]];

    await dispatchOperatorExecute(
      { ...baseInput, approvedPlan: reordered },
      fetchMock as unknown as typeof fetch
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    );
    expect(body.approved_plan.map((s: { index: number }) => s.index)).toEqual([
      1, 0,
    ]);
    expect(body.approved_plan[0].description).toBe(
      "USER-EDITED: draft a one-page customer-facing brief"
    );
  });
});
