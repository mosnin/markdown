import { describe, it, expect } from "vitest";
import {
  requireNoBranchTargeting,
  toConnectionRequestContext,
  BranchTargetingNotAllowedError,
  type McpAuthContext,
} from "@/server/auth/mcp_auth_adapter";

/**
 * Unit tests for the two helpers the v1 write routes lean on:
 *   - requireNoBranchTargeting (OAuth-backed writes target main only)
 *   - toConnectionRequestContext (shape bridge for existing services)
 */

function oauthCtx(overrides: Partial<McpAuthContext> = {}): McpAuthContext {
  return {
    source: "oauth",
    userId: "00000000-0000-0000-0000-00000000aaaa",
    workspaceId: "00000000-0000-0000-0000-00000000bbbb",
    role: "member",
    scopes: ["context:propose"],
    allowedBoxIds: new Set(["b1"]),
    clientId: "demo-client",
    connectionId: "tok-1",
    permissionMode: "propose_writes",
    tokenId: "tok-1",
    deprecated: false,
    ...overrides,
  };
}

function legacyCtx(overrides: Partial<McpAuthContext> = {}): McpAuthContext {
  return {
    source: "legacy_csk",
    userId: null,
    workspaceId: "00000000-0000-0000-0000-00000000bbbb",
    role: null,
    scopes: [],
    allowedBoxIds: new Set(),
    clientId: null,
    connectionId: "conn-legacy-1",
    permissionMode: "propose_writes",
    tokenId: "tok-legacy-1",
    deprecated: true,
    ...overrides,
  };
}

describe("requireNoBranchTargeting", () => {
  it("allows OAuth writes that omit branch_id", () => {
    expect(() => requireNoBranchTargeting(oauthCtx(), null)).not.toThrow();
    expect(() => requireNoBranchTargeting(oauthCtx(), undefined)).not.toThrow();
  });

  it("allows OAuth writes that pass an empty branch_id string", () => {
    expect(() => requireNoBranchTargeting(oauthCtx(), "")).not.toThrow();
    expect(() => requireNoBranchTargeting(oauthCtx(), "   ")).not.toThrow();
  });

  it("rejects OAuth writes that pass a non-empty branch_id", () => {
    expect(() =>
      requireNoBranchTargeting(
        oauthCtx(),
        "00000000-0000-0000-0000-cccccccccccc"
      )
    ).toThrow(BranchTargetingNotAllowedError);
  });

  it("exposes the requested branch id on the error", () => {
    try {
      requireNoBranchTargeting(oauthCtx(), "my-branch");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BranchTargetingNotAllowedError);
      expect((err as BranchTargetingNotAllowedError).requestedBranchId).toBe(
        "my-branch"
      );
      expect((err as BranchTargetingNotAllowedError).code).toBe(
        "branch_targeting_not_allowed"
      );
    }
  });

  it("leaves legacy csk_v1_ writes alone regardless of branch_id", () => {
    expect(() =>
      requireNoBranchTargeting(legacyCtx(), "anything")
    ).not.toThrow();
  });
});

describe("toConnectionRequestContext", () => {
  it("synthesises a Connection-shaped bridge for OAuth", () => {
    const ctx = oauthCtx({
      clientId: "my-client",
      connectionId: "tok-42",
      tokenId: "tok-42",
    });
    const bridge = toConnectionRequestContext(ctx);
    expect(bridge.connection.id).toBe("tok-42");
    expect(bridge.connection.workspace_id).toBe(ctx.workspaceId);
    expect(bridge.connection.name).toBe("oauth:my-client");
    expect(bridge.connection.permission_mode).toBe("propose_writes");
    expect(bridge.connection.metadata).toMatchObject({
      auth_source: "oauth",
      oauth_client_id: "my-client",
    });
    expect(bridge.workspaceId).toBe(ctx.workspaceId);
    expect(bridge.allowedBoxIds).toBe(ctx.allowedBoxIds);
    expect(bridge.tokenId).toBe("tok-42");
  });

  it("preserves legacy csk_v1_ connection identity", () => {
    const ctx = legacyCtx({ connectionId: "conn-x" });
    const bridge = toConnectionRequestContext(ctx);
    expect(bridge.connection.id).toBe("conn-x");
    expect(bridge.connection.name).toBe("connection:conn-x");
    expect(bridge.connection.metadata).toEqual({ auth_source: "legacy_csk" });
    expect(bridge.connection.status).toBe("active");
    expect(bridge.connection.connection_type).toBe("mcp");
  });
});
