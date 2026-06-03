import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the connected-agent cap wired into `createConnection`
 * (audit issue #2). `checkConnectedAgentQuota` was previously unwired; these
 * tests assert it now gates connection creation:
 *   - over quota → throws an upgrade error and creates NOTHING
 *   - under quota → proceeds to create the connection + initial token
 */

vi.mock("@/server/repositories/connection_repository");
vi.mock("@/server/services/audit_service");
vi.mock("@/server/services/write_proposal_service");
vi.mock("@/server/services/proposal_quota_service");

import { createConnection } from "@/server/services/connection_service";
import * as connRepo from "@/server/repositories/connection_repository";
import * as quotaService from "@/server/services/proposal_quota_service";
import { CONNECTED_AGENT_TIER_LIMITS } from "@/server/domain/constants/proposal_quota";

const WORKSPACE_ID = "ws-conn-001";
const ACTOR_ID = "user-conn-001";

const INPUT = {
  name: "Test Agent",
  connection_type: "mcp" as const,
  permission_mode: "propose_writes" as const,
};

function quotaStatus(allowed: boolean, used: number, limit: number) {
  return {
    tier: "free" as const,
    limit,
    used,
    allowed,
    resetsAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createConnection — connected-agent cap", () => {
  it("throws an upgrade error and creates nothing when over the cap", async () => {
    vi.mocked(quotaService.checkConnectedAgentQuota).mockResolvedValue(
      quotaStatus(false, CONNECTED_AGENT_TIER_LIMITS.free, CONNECTED_AGENT_TIER_LIMITS.free)
    );

    await expect(
      createConnection({} as never, WORKSPACE_ID, ACTOR_ID, INPUT)
    ).rejects.toThrow(/limit reached/i);

    // The cap is enforced BEFORE any write — no connection row is inserted.
    expect(connRepo.createConnection).not.toHaveBeenCalled();
    expect(connRepo.createConnectionToken).not.toHaveBeenCalled();
  });

  it("surfaces the tier/limit and upgrade URL in the error message", async () => {
    vi.mocked(quotaService.checkConnectedAgentQuota).mockResolvedValue(
      quotaStatus(false, 1, 1)
    );

    await expect(
      createConnection({} as never, WORKSPACE_ID, ACTOR_ID, INPUT)
    ).rejects.toThrow(/\/pricing/);
  });

  it("proceeds to create the connection when under the cap", async () => {
    vi.mocked(quotaService.checkConnectedAgentQuota).mockResolvedValue(
      quotaStatus(true, 0, CONNECTED_AGENT_TIER_LIMITS.free)
    );

    const createdConnection = {
      id: "conn-new",
      workspace_id: WORKSPACE_ID,
      name: INPUT.name,
      permission_mode: INPUT.permission_mode,
    };
    vi.mocked(connRepo.createConnection).mockResolvedValue(createdConnection as never);
    vi.mocked(connRepo.createConnectionToken).mockResolvedValue({} as never);

    const result = await createConnection({} as never, WORKSPACE_ID, ACTOR_ID, INPUT);

    expect(connRepo.createConnection).toHaveBeenCalledOnce();
    expect(connRepo.createConnectionToken).toHaveBeenCalledOnce();
    expect(result.connection).toEqual(createdConnection);
    // The one-time raw token is returned for display.
    expect(result.rawToken).toMatch(/^csk_v1_/);
  });
});
