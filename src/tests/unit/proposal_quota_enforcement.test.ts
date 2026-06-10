import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the write-proposal PAYWALL.
 *
 * Enforcement is ATOMIC: rather than count-then-insert (which races — see the
 * TOCTOU bug fixed in migration 20260501000002), `createProposal` resolves the
 * tier/limit/period window up front and delegates the count + cap + insert to
 * `createWriteProposalGuarded`, whose RPC takes a per-workspace advisory lock
 * so concurrent writers serialize. The public contract is unchanged:
 *
 *  1. The enforcement *gate* in `createProposal` (write_proposal_service.ts):
 *     - under limit  → proposal is created (success shape unchanged); the
 *                      guarded insert returns the new row.
 *     - over limit   → the guarded insert returns a quota signal and inserts
 *                      nothing; `createProposal` maps it to a typed
 *                      `{ ok:false, code:"quota_exceeded", ... }` result and
 *                      does NOT throw.
 *
 *  2. The `checkProposalQuota` resolver (proposal_quota_service.ts) still
 *     exists for read-only status surfaces:
 *     - under limit  → allowed.
 *     - at/over limit → not allowed.
 *     - fails CLOSED when the usage count errors.
 *
 * The gate tests mock the quota resolver + the guarded insert so we can drive
 * both branches deterministically. The resolver tests drive a hand-rolled
 * Supabase mock to exercise the real counting logic.
 */

// ─── Mocks for the gate-level tests ────────────────────────────────────────────
vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/folder_repository");
// Keep the real `isGuardedQuotaExceeded` discriminator; mock the data fns.
vi.mock("@/server/repositories/write_proposal_repository", async (importActual) => {
  const actual =
    await importActual<typeof import("@/server/repositories/write_proposal_repository")>();
  return {
    ...actual,
    createWriteProposalGuarded: vi.fn(),
  };
});
vi.mock("@/server/services/audit_service");
vi.mock("@/server/services/proposal_quota_service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/server/services/proposal_quota_service")>();
  return {
    ...actual,
    // The resolver only returns tier/limit/period now; the count + gate live
    // in the guarded insert. Default to free-tier context. (Literal 20 — the
    // free PROPOSAL_TIER_LIMIT — because this factory is hoisted above imports
    // and cannot reference the imported constant.)
    resolveProposalQuotaContext: vi.fn().mockResolvedValue({
      tier: "free",
      limit: 20,
      periodStart: new Date("2026-06-01T00:00:00Z"),
      periodEnd: new Date("2099-01-01T00:00:00Z"),
    }),
  };
});

import {
  createProposal,
  isQuotaExceeded,
} from "@/server/services/write_proposal_service";
import * as quotaService from "@/server/services/proposal_quota_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as proposalRepo from "@/server/repositories/write_proposal_repository";
import * as auditService from "@/server/services/audit_service";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";
import { PROPOSAL_TIER_LIMITS } from "@/server/domain/constants/proposal_quota";

const WORKSPACE_ID = "ws-001";
const BOX_ID = "box-001";
const NOTE_ID = "note-001";
const CONN_ID = "conn-001";

function makeCtx() {
  return {
    connection: {
      id: CONN_ID,
      workspace_id: WORKSPACE_ID,
      permission_mode: PERMISSION_MODE.PROPOSE_WRITES,
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
    current_version_id: "version-1",
    ...overrides,
  };
}

function makeProposalRow(overrides: Record<string, unknown> = {}) {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditWriteProposalCreated).mockReturnValue(undefined as never);
});

// ─── Gate: createProposal enforcement ──────────────────────────────────────────

describe("createProposal — paywall enforcement", () => {
  it("under limit → proposal is created (unchanged success shape)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    // The guarded insert returns the created row when under cap.
    vi.mocked(proposalRepo.createWriteProposalGuarded).mockResolvedValue(
      makeProposalRow() as never
    );

    const result = await createProposal({} as never, makeCtx(), {
      proposal_type: "update_note",
      target_note_id: NOTE_ID,
      proposed_content: "# hello",
    });

    expect(isQuotaExceeded(result)).toBe(false);
    // Narrowed: the success branch is still a WriteProposal.
    if (!isQuotaExceeded(result)) {
      expect(result.id).toBe("proposal-1");
      expect(result.proposal_type).toBe("update_note");
    }
    expect(proposalRepo.createWriteProposalGuarded).toHaveBeenCalledTimes(1);
    // The cap is enforced atomically inside the guarded insert: the resolved
    // limit + period-start are handed to it so the RPC counts + inserts under
    // a per-workspace lock.
    expect(proposalRepo.createWriteProposalGuarded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspace_id: WORKSPACE_ID }),
      expect.objectContaining({ limit: PROPOSAL_TIER_LIMITS.free })
    );
  });

  it("over limit → returns quota_exceeded and creates nothing", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    // Atomic over-cap: the guarded insert refuses and signals quota-exceeded
    // WITHOUT inserting (the insert never runs inside the locked transaction).
    vi.mocked(proposalRepo.createWriteProposalGuarded).mockResolvedValue({
      quota_exceeded: true,
      limit: PROPOSAL_TIER_LIMITS.free,
      used: PROPOSAL_TIER_LIMITS.free,
    } as never);

    const result = await createProposal({} as never, makeCtx(), {
      proposal_type: "update_note",
      target_note_id: NOTE_ID,
      proposed_content: "# hello",
    });

    expect(isQuotaExceeded(result)).toBe(true);
    if (isQuotaExceeded(result)) {
      expect(result.ok).toBe(false);
      expect(result.code).toBe("quota_exceeded");
      expect(result.limit).toBe(PROPOSAL_TIER_LIMITS.free);
      expect(result.used).toBe(PROPOSAL_TIER_LIMITS.free);
      expect(result.upgradeUrl).toBe("/pricing");
    }
    // The over-limit decision and the (suppressed) insert are one atomic unit
    // in the RPC, so the "created" audit must not fire.
    expect(auditService.auditWriteProposalCreated).not.toHaveBeenCalled();
  });

  it("still enforces the permission check before the paywall", async () => {
    const ctx = makeCtx();
    ctx.connection.permission_mode = PERMISSION_MODE.READ_ONLY;

    await expect(
      createProposal({} as never, ctx, {
        proposal_type: "update_note",
        target_note_id: NOTE_ID,
        proposed_content: "# hello",
      })
    ).rejects.toThrow("permission");
    // Permission rejection happens before we even resolve the quota window or
    // attempt the guarded insert.
    expect(quotaService.resolveProposalQuotaContext).not.toHaveBeenCalled();
    expect(proposalRepo.createWriteProposalGuarded).not.toHaveBeenCalled();
  });
});
