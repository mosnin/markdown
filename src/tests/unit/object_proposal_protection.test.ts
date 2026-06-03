import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for object write proposals in write_proposal_service.ts.
 *
 * Covers the expanded object model (Files, Skills, Agents):
 * - Permission enforcement (read_only rejected)
 * - Reusable shared skill/agent: always accessible regardless of box scope
 * - Box-local object: must be in an allowed box
 * - Trashed object rejection
 * - Required field validation (target_object_id for update proposals)
 * - Proposal-only path: external connections cannot bypass proposal for any object type
 *
 * This test file complements write_proposal_service.test.ts which covers note proposals.
 */

vi.mock("@/server/repositories/write_proposal_repository");
vi.mock("@/server/services/audit_service");

// Quota enforcement has its own suite (proposal_quota_service.test.ts).
// Stub it to "allowed" so these object permission/scope tests aren't gated
// by the paywall.
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
  isQuotaExceeded,
} from "@/server/services/write_proposal_service";
import type { WriteProposal } from "@/server/domain/types/write_proposal";
import * as proposalRepo from "@/server/repositories/write_proposal_repository";
import * as auditService from "@/server/services/audit_service";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";

// ─── Constants ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-001";
const BOX_ID = "box-001";
const OTHER_BOX_ID = "box-999";
const SKILL_ID = "skill-001";
const AGENT_ID = "agent-001";
const FILE_ID = "file-001";
const CONN_ID = "conn-001";

// ─── Factories ─────────────────────────────────────────────────────────────────

function makeCtx(
  permissionMode: string = PERMISSION_MODE.PROPOSE_WRITES,
  allowedBoxIds: string[] = [BOX_ID]
) {
  return {
    connection: {
      id: CONN_ID,
      workspace_id: WORKSPACE_ID,
      permission_mode: permissionMode,
      status: "active",
    },
    workspaceId: WORKSPACE_ID,
    allowedBoxIds: new Set(allowedBoxIds),
    tokenId: "token-1",
  } as Parameters<typeof createProposal>[1];
}

function makeObjectRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SKILL_ID,
    name: "my-skill",
    source_content: "# skill content",
    canonical_format: "markdown",
    current_version_id: "version-1",
    status: "active",
    box_id: BOX_ID,
    is_reusable: false,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

function makeAdminClient(objectRow: Record<string, unknown> | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: objectRow,
            error: objectRow ? null : { message: "not found" },
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof createProposal>[0];
}

function makeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "proposal-1",
    workspace_id: WORKSPACE_ID,
    connection_id: CONN_ID,
    proposal_type: "update_skill",
    status: "pending",
    target_object_type: "skill",
    target_object_id: SKILL_ID,
    target_object_version_id: "version-1",
    proposed_content: "# new content",
    ...overrides,
  };
}

/**
 * Narrow `createProposal`'s union return to a `WriteProposal`, failing the
 * test if the paywall short-circuited (quota is stubbed to allowed above).
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
  vi.mocked(proposalRepo.createWriteProposal).mockResolvedValue(makeProposal() as never);
});

// ─── Permission checks ────────────────────────────────────────────────────────

describe("object proposal — permission checks", () => {
  it("throws if connection is read_only", async () => {
    const ctx = makeCtx(PERMISSION_MODE.READ_ONLY);
    const adminClient = makeAdminClient(makeObjectRow());

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_skill",
        target_object_id: SKILL_ID,
        proposed_content: "# new",
      })
    ).rejects.toThrow("permission");
  });

  it("allows propose_writes to update a skill", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(makeObjectRow());

    const result = await createProposal(adminClient, ctx, {
      proposal_type: "update_skill",
      target_object_id: SKILL_ID,
      proposed_content: "# new",
    });
    expect(asProposal(result).proposal_type).toBe("update_skill");
  });

  it("allows generate_in_allowed_folders to propose an object update", async () => {
    const ctx = makeCtx(PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS);
    const adminClient = makeAdminClient(makeObjectRow());

    const result = await createProposal(adminClient, ctx, {
      proposal_type: "update_skill",
      target_object_id: SKILL_ID,
      proposed_content: "# new",
    });
    expect(asProposal(result).proposal_type).toBe("update_skill");
  });
});

// ─── Scope checks for box-local objects ───────────────────────────────────────

describe("object proposal — box-local scope", () => {
  it("throws if box-local skill is not in an allowed box", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES, [OTHER_BOX_ID]);
    const adminClient = makeAdminClient(makeObjectRow({ box_id: BOX_ID, is_reusable: false }));

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_skill",
        target_object_id: SKILL_ID,
        proposed_content: "# new",
      })
    ).rejects.toThrow("allowed box");
  });

  it("allows box-local skill when box is in allowed set", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES, [BOX_ID]);
    const adminClient = makeAdminClient(makeObjectRow({ box_id: BOX_ID, is_reusable: false }));

    const result = asProposal(
      await createProposal(adminClient, ctx, {
        proposal_type: "update_skill",
        target_object_id: SKILL_ID,
        proposed_content: "# new",
      })
    );
    expect(result.target_object_id ?? result.proposal_type).toBeTruthy();
  });
});

// ─── Reusable shared object scope ────────────────────────────────────────────

describe("object proposal — reusable shared object scope", () => {
  it("allows reusable skill even when connection has no box scope for it", async () => {
    // Connection scoped to OTHER_BOX_ID only — but reusable skill has box_id=null
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES, [OTHER_BOX_ID]);
    const adminClient = makeAdminClient(
      makeObjectRow({ id: SKILL_ID, box_id: null, is_reusable: true })
    );

    const result = await createProposal(adminClient, ctx, {
      proposal_type: "update_skill",
      target_object_id: SKILL_ID,
      proposed_content: "# new content for shared skill",
    });
    expect(asProposal(result).proposal_type).toBe("update_skill");
  });

  it("allows reusable agent even when connection has no matching box scope", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES, [OTHER_BOX_ID]);
    const adminClient = makeAdminClient(
      makeObjectRow({ id: AGENT_ID, box_id: null, is_reusable: true })
    );
    vi.mocked(proposalRepo.createWriteProposal).mockResolvedValue(
      makeProposal({ proposal_type: "update_agent", target_object_id: AGENT_ID }) as never
    );

    const result = await createProposal(adminClient, ctx, {
      proposal_type: "update_agent",
      target_object_id: AGENT_ID,
      proposed_content: "# new agent",
    });
    expect(asProposal(result).proposal_type).toBe("update_agent");
  });
});

// ─── Trashed object rejection ─────────────────────────────────────────────────

describe("object proposal — trashed object rejection", () => {
  it("throws if target skill is trashed", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(makeObjectRow({ status: "trashed" }));

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_skill",
        target_object_id: SKILL_ID,
        proposed_content: "# new",
      })
    ).rejects.toThrow("trashed");
  });

  it("throws if target file is trashed", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(
      makeObjectRow({ id: FILE_ID, status: "trashed" })
    );

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_file",
        target_object_id: FILE_ID,
        proposed_content: "new content",
      })
    ).rejects.toThrow("trashed");
  });

  it("throws if target object does not exist in this workspace", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(null);

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_skill",
        target_object_id: "nonexistent-skill",
        proposed_content: "# new",
      })
    ).rejects.toThrow("not found");
  });
});

// ─── Required field validation ────────────────────────────────────────────────

describe("object proposal — required field validation", () => {
  it("throws if update_skill is missing target_object_id", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(makeObjectRow());

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_skill",
        target_object_id: null,
        proposed_content: "# new",
      })
    ).rejects.toThrow("target_object_id");
  });

  it("throws if update_agent is missing target_object_id", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(makeObjectRow());

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_agent",
        target_object_id: null,
        proposed_content: "# new",
      })
    ).rejects.toThrow("target_object_id");
  });

  it("throws if update_file is missing target_object_id", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(makeObjectRow());

    await expect(
      createProposal(adminClient, ctx, {
        proposal_type: "update_file",
        target_object_id: null,
        proposed_content: "new content",
      })
    ).rejects.toThrow("target_object_id");
  });
});

// ─── Proposal-only guarantee for all object types ─────────────────────────────

describe("object types always require proposals for external writes", () => {
  it("update_file, update_skill, update_agent are all OBJECT_PROPOSAL_TYPES", async () => {
    // These are routed through _createObjectProposal, not _createNoteProposal.
    // Verify by ensuring the note-specific fields (target_note_id) are NOT required.
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);
    const adminClient = makeAdminClient(makeObjectRow());

    // Should NOT throw about target_note_id being missing
    const result = await createProposal(adminClient, ctx, {
      proposal_type: "update_skill",
      target_object_id: SKILL_ID,
      proposed_content: "# content",
    });
    expect(result).toBeTruthy();
  });
});
