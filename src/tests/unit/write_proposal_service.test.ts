import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for write_proposal_service.ts
 *
 * Covers:
 * - Permission checks (canPropose)
 * - Ownership checks for target note/folder
 * - Slug generation logic
 * - Proposal approval/rejection guards
 */

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/box_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/repositories/write_proposal_repository");
vi.mock("@/server/services/audit_service");

// Quota enforcement has its own suite (proposal_quota_service.test.ts).
// Here we stub it to "allowed" so these permission/ownership tests stay
// focused on the proposal logic and aren't gated by the paywall.
vi.mock("@/server/services/proposal_quota_service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/server/services/proposal_quota_service")>();
  return {
    ...actual,
    checkProposalQuota: vi.fn().mockResolvedValue({
      tier: "free",
      limit: 20,
      used: 0,
      allowed: true,
      resetsAt: new Date("2099-01-01T00:00:00Z"),
    }),
  };
});

import {
  createProposal,
  approveProposal,
  rejectProposal,
  isQuotaExceeded,
  type WriteProposal,
} from "@/server/services/write_proposal_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as folderRepo from "@/server/repositories/folder_repository";
import * as proposalRepo from "@/server/repositories/write_proposal_repository";
import * as auditService from "@/server/services/audit_service";
import { PERMISSION_MODE, type PermissionMode } from "@/server/domain/constants/connection_constants";

const mockSupabase = {} as Parameters<typeof createProposal>[0];
const WORKSPACE_ID = "ws-001";
const BOX_ID = "box-001";
const FOLDER_ID = "folder-001";
const NOTE_ID = "note-001";
const CONN_ID = "conn-001";

function makeCtx(permissionMode: PermissionMode = PERMISSION_MODE.PROPOSE_WRITES) {
  return {
    connection: {
      id: CONN_ID,
      workspace_id: WORKSPACE_ID,
      permission_mode: permissionMode,
      status: "active",
    },
    workspaceId: WORKSPACE_ID,
    allowedBoxIds: new Set([BOX_ID]),
    tokenId: "token-1",
  } as Parameters<typeof createProposal>[1];
}

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    box_id: BOX_ID,
    status: "active",
    title: "Test Note",
    current_version_id: "version-1",
    ...overrides,
  };
}

function makeFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: FOLDER_ID,
    box_id: BOX_ID,
    status: "active",
    name: "Test Folder",
    path_cache: "test-folder",
    ...overrides,
  };
}

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    workspace_id: WORKSPACE_ID,
    connection_id: CONN_ID,
    proposal_type: "update_note",
    status: "pending",
    target_note_id: NOTE_ID,
    target_version_id: "version-1",
    proposed_folder_id: null,
    ...overrides,
  };
}

/**
 * Narrow `createProposal`'s union return to a `WriteProposal`, failing the
 * test if the paywall short-circuited (which it must not here — quota is
 * stubbed to allowed above).
 */
function asProposal(
  result: Awaited<ReturnType<typeof createProposal>>
): WriteProposal {
  if (isQuotaExceeded(result)) {
    throw new Error("Expected a proposal but got quota_exceeded");
  }
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditWriteProposalCreated).mockReturnValue(undefined as never);
  vi.mocked(auditService.auditWriteProposalApproved).mockReturnValue(undefined as never);
  vi.mocked(auditService.auditWriteProposalRejected).mockReturnValue(undefined as never);
  vi.mocked(auditService.auditWriteProposalConflicted).mockReturnValue(undefined as never);
});

describe("createProposal — permission checks", () => {
  it("throws if connection is read_only", async () => {
    const ctx = makeCtx(PERMISSION_MODE.READ_ONLY);
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);

    await expect(
      createProposal(mockSupabase, ctx, {
        proposal_type: "update_note",
        target_note_id: NOTE_ID,
      })
    ).rejects.toThrow("permission");
  });

  it("allows propose_writes permission", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(proposalRepo.createWriteProposal).mockResolvedValue(
      makeProposal() as never
    );

    const result = await createProposal(mockSupabase, ctx, {
      proposal_type: "update_note",
      target_note_id: NOTE_ID,
    });
    expect(asProposal(result).proposal_type).toBe("update_note");
  });

  it("allows generate_in_allowed_folders permission for create_note", async () => {
    const ctx = makeCtx(PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS);
    vi.mocked(folderRepo.getFolderById).mockResolvedValue(makeFolder() as never);
    vi.mocked(proposalRepo.createWriteProposal).mockResolvedValue(
      makeProposal({ proposal_type: "create_note" }) as never
    );

    const result = await createProposal(mockSupabase, ctx, {
      proposal_type: "create_note",
      target_folder_id: FOLDER_ID,
    });
    expect(asProposal(result).proposal_type).toBe("create_note");
  });
});

describe("createProposal — ownership checks", () => {
  it("throws if target note is not in allowed boxes", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    ctx.allowedBoxIds = new Set(["other-box"]);
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);

    await expect(
      createProposal(mockSupabase, ctx, {
        proposal_type: "update_note",
        target_note_id: NOTE_ID,
      })
    ).rejects.toThrow("allowed box");
  });

  it("throws if target note is trashed", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeNote({ status: "trashed" }) as never
    );

    await expect(
      createProposal(mockSupabase, ctx, {
        proposal_type: "update_note",
        target_note_id: NOTE_ID,
      })
    ).rejects.toThrow("not found");
  });

  it("throws if target note does not exist", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);

    await expect(
      createProposal(mockSupabase, ctx, {
        proposal_type: "update_note",
        target_note_id: NOTE_ID,
      })
    ).rejects.toThrow("not found");
  });

  it("throws if create_note target folder is in a different box", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    ctx.allowedBoxIds = new Set(["other-box"]);
    vi.mocked(folderRepo.getFolderById).mockResolvedValue(makeFolder() as never);

    await expect(
      createProposal(mockSupabase, ctx, {
        proposal_type: "create_note",
        target_folder_id: FOLDER_ID,
      })
    ).rejects.toThrow("allowed box");
  });
});

describe("createProposal — required field validation", () => {
  it("throws if update_note is missing target_note_id", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    await expect(
      createProposal(mockSupabase, ctx, {
        proposal_type: "update_note",
        target_note_id: null,
      })
    ).rejects.toThrow("target_note_id is required");
  });

  it("throws if create_note is missing target_folder_id", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    await expect(
      createProposal(mockSupabase, ctx, {
        proposal_type: "create_note",
        target_folder_id: null,
      })
    ).rejects.toThrow("target_folder_id is required");
  });
});

describe("approveProposal — guards", () => {
  it("throws if proposal does not belong to workspace", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makeProposal({ workspace_id: "other-ws" }) as never
    );

    await expect(
      approveProposal(mockSupabase, "user-1", WORKSPACE_ID, "proposal-1")
    ).rejects.toThrow("not found");
  });

  it("throws if proposal is not pending", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makeProposal({ status: "rejected" }) as never
    );

    await expect(
      approveProposal(mockSupabase, "user-1", WORKSPACE_ID, "proposal-1")
    ).rejects.toThrow("not pending");
  });
});

describe("rejectProposal — guards", () => {
  it("throws if proposal is not pending", async () => {
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(
      makeProposal({ status: "approved" }) as never
    );

    await expect(
      rejectProposal(mockSupabase, "user-1", WORKSPACE_ID, "proposal-1")
    ).rejects.toThrow("not pending");
  });

  it("rejects a pending proposal successfully", async () => {
    const pending = makeProposal();
    vi.mocked(proposalRepo.getWriteProposalById).mockResolvedValue(pending as never);
    vi.mocked(proposalRepo.updateWriteProposal).mockResolvedValue(
      makeProposal({ status: "rejected" }) as never
    );

    const result = await rejectProposal(mockSupabase, "user-1", WORKSPACE_ID, "proposal-1");
    expect(result.status).toBe("rejected");
  });
});
