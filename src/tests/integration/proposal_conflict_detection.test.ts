import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests: write proposal conflict detection
 *
 * Validates that `approveProposal` correctly handles the case where the target
 * note's current_version_id has changed since the proposal was submitted
 * (stale proposal). In this scenario:
 *
 *   - The SQL function `approve_write_proposal_update` detects the version
 *     mismatch and returns outcome:"conflicted".
 *   - The service records a `conflicted` audit event.
 *   - The service returns { outcome: "conflicted", reason: "..." }.
 *   - No note mutation occurs (the SQL function guarantees atomicity).
 *
 * Also validates the approval happy path to confirm the full service path.
 */

vi.mock("@/server/repositories/write_proposal_repository");
vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/services/audit_service");

import { approveProposal } from "@/server/services/write_proposal_service";
import * as proposalRepo from "@/server/repositories/write_proposal_repository";
import * as auditService from "@/server/services/audit_service";

const WORKSPACE_ID = "ws-integration-001";
const PROPOSAL_ID = "proposal-integration-001";
const NOTE_ID = "note-001";
const CONN_ID = "conn-001";
const REVIEWER_ID = "user-001";

// Version IDs
const VERSION_AT_SUBMISSION = "version-at-submission";
const VERSION_CURRENT = "version-newer";  // note was edited after proposal submitted

function makePendingProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    workspace_id: WORKSPACE_ID,
    connection_id: CONN_ID,
    proposal_type: "update_note",
    status: "pending",
    target_note_id: NOTE_ID,
    target_version_id: VERSION_AT_SUBMISSION,
    proposed_content: "New content from AI",
    proposed_folder_id: null,
    ...overrides,
  };
}

/**
 * Build a Supabase-like mock client that satisfies the subset of the
 * builder surface approveProposal now touches:
 *   - .rpc (existing — for the approval SQL function)
 *   - .from("change_sets").insert(...).select().single() for openChangeSet
 *   - .from("change_sets").update(...).eq(...).eq(...)            for commit/abort
 *   - .from("change_sets").select(...).eq(...).maybeSingle()      for state reads
 *   - .from("change_set_items").insert(...).select().single()
 *   - .from("write_proposals").update(...).eq(...)                for linking
 */
function buildMockSupabase(rpcImpl: (...args: unknown[]) => unknown) {
  const changeSet = {
    id: "cs-test",
    workspace_id: WORKSPACE_ID,
    origin: "proposal_approval",
    actor_type: "user",
    actor_id: REVIEWER_ID,
    status: "open",
    summary: null,
    metadata: {},
    parent_change_set_id: null,
    created_at: new Date().toISOString(),
    committed_at: null,
    aborted_at: null,
  };

  function fromFn(table: string) {
    const builder: Record<string, unknown> = {};
    builder.insert = () => ({
      select: () => ({
        single: () => Promise.resolve({ data: { ...changeSet }, error: null }),
      }),
    });
    builder.update = () => ({
      eq: () => ({
        eq: () => Promise.resolve({ error: null, data: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    });
    builder.select = () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({
          data: table === "change_sets" ? { ...changeSet, status: "open" } : null,
          error: null,
        }),
        order: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
    return builder;
  }

  return {
    rpc: rpcImpl,
    from: fromFn,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditWriteProposalApproved).mockReturnValue(undefined as never);
  vi.mocked(auditService.auditWriteProposalConflicted).mockReturnValue(undefined as never);
  vi.mocked(auditService.auditWriteProposalRejected).mockReturnValue(undefined as never);
  vi.mocked(auditService.auditWriteProposalCreated).mockReturnValue(undefined as never);
});

describe("Proposal approval — conflict detection", () => {
  it("returns conflicted when the SQL RPC detects a version mismatch", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makePendingProposal() as never
    );

    // Simulate the SQL function detecting the version has changed
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "conflicted",
        reason: `Version mismatch: proposal targeted ${VERSION_AT_SUBMISSION} but current is ${VERSION_CURRENT}`,
      },
      error: null,
    });

    const mockSupabase = buildMockSupabase(mockRpc) as never;

    const result = await approveProposal(
      mockSupabase,
      REVIEWER_ID,
      WORKSPACE_ID,
      PROPOSAL_ID
    );

    expect(result.outcome).toBe("conflicted");
    expect(result.reason).toContain("Version mismatch");
    // Confirm note is NOT returned on conflict — no mutation
    expect(result.note).toBeUndefined();
  });

  it("fires a conflicted audit event when a version conflict is detected", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makePendingProposal() as never
    );

    const mockSupabase = buildMockSupabase(
      vi.fn().mockResolvedValue({
        data: { outcome: "conflicted", reason: "stale" },
        error: null,
      })
    ) as never;

    await approveProposal(mockSupabase, REVIEWER_ID, WORKSPACE_ID, PROPOSAL_ID);

    expect(vi.mocked(auditService.auditWriteProposalConflicted)).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      REVIEWER_ID,
      PROPOSAL_ID,
      expect.objectContaining({ connection_id: CONN_ID })
    );
    // Must NOT fire an approved audit event
    expect(vi.mocked(auditService.auditWriteProposalApproved)).not.toHaveBeenCalled();
  });

  it("returns approved and fires approved audit on successful approval", async () => {
    const approvedNote = { id: NOTE_ID, title: "Updated Note", status: "active" };
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makePendingProposal() as never
    );

    const mockSupabase = buildMockSupabase(
      vi.fn().mockResolvedValue({
        data: { outcome: "approved", note: approvedNote },
        error: null,
      })
    ) as never;

    const result = await approveProposal(
      mockSupabase,
      REVIEWER_ID,
      WORKSPACE_ID,
      PROPOSAL_ID
    );

    expect(result.outcome).toBe("approved");
    expect(result.note).toEqual(approvedNote);
    expect(vi.mocked(auditService.auditWriteProposalApproved)).toHaveBeenCalledOnce();
    expect(vi.mocked(auditService.auditWriteProposalConflicted)).not.toHaveBeenCalled();
  });

  it("rejects approval if proposal does not belong to workspace (ownership guard)", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makePendingProposal({ workspace_id: "other-workspace" }) as never
    );

    await expect(
      approveProposal({} as never, REVIEWER_ID, WORKSPACE_ID, PROPOSAL_ID)
    ).rejects.toThrow("not found");
  });

  it("rejects approval if proposal is already approved (not pending)", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makePendingProposal({ status: "approved" }) as never
    );

    await expect(
      approveProposal({} as never, REVIEWER_ID, WORKSPACE_ID, PROPOSAL_ID)
    ).rejects.toThrow("not pending");
  });

  it("rejects approval if proposal is conflicted", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makePendingProposal({ status: "conflicted" }) as never
    );

    await expect(
      approveProposal({} as never, REVIEWER_ID, WORKSPACE_ID, PROPOSAL_ID)
    ).rejects.toThrow("not pending");
  });
});
