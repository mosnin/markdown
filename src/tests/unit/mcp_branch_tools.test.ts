import { describe, it, expect } from "vitest";
import {
  requireNoBranchTargeting,
  BranchTargetingNotAllowedError,
  type McpAuthContext,
} from "@/server/auth/mcp_auth_adapter";
import {
  hasScope,
  parseScopeString,
  isCapabilityScope,
  ALL_SCOPES,
} from "@/server/services/oauth_scope_service";
import {
  SCOPE_DESCRIPTIONS,
  SCOPE_GROUP_LABELS,
  groupScopes,
} from "@/lib/oauth_scope_descriptions";

/**
 * Unit tests for AI-authored branch MCP tools.
 *
 * Covers:
 *   - context:branch scope registration and description
 *   - requireNoBranchTargeting allows branch-scope writes to owned branches
 *   - requireNoBranchTargeting rejects cross-client writes
 *   - requireNoBranchTargeting rejects writes without context:branch scope
 *   - Scope grouping includes the "branch" group
 */

function oauthCtx(overrides: Partial<McpAuthContext> = {}): McpAuthContext {
  return {
    source: "oauth",
    userId: "00000000-0000-0000-0000-00000000aaaa",
    workspaceId: "00000000-0000-0000-0000-00000000bbbb",
    role: "member",
    scopes: ["context:branch", "context:propose"],
    allowedBoxIds: new Set(["b1"]),
    clientId: "demo-client",
    connectionId: "tok-1",
    permissionMode: "propose_writes",
    tokenId: "tok-1",
    deprecated: false,
    ...overrides,
  };
}

const BRANCH_ID = "00000000-0000-0000-0000-cccccccccccc";

describe("context:branch scope registration", () => {
  it("context:branch is a recognized capability scope", () => {
    expect(isCapabilityScope("context:branch")).toBe(true);
    expect(ALL_SCOPES).toContain("context:branch");
  });

  it("hasScope detects context:branch in a scope array", () => {
    expect(hasScope(["context:read", "context:branch"], "context:branch")).toBe(true);
    expect(hasScope(["context:read"], "context:branch")).toBe(false);
  });

  it("parseScopeString parses context:branch from a string", () => {
    const scopes = parseScopeString("context:read context:branch");
    expect(scopes).toContain("context:branch");
  });

  it("context:branch has a scope description", () => {
    expect(SCOPE_DESCRIPTIONS["context:branch"]).toBeDefined();
    expect(SCOPE_DESCRIPTIONS["context:branch"].title.length).toBeGreaterThan(0);
    expect(SCOPE_DESCRIPTIONS["context:branch"].group).toBe("branch");
    expect(SCOPE_DESCRIPTIONS["context:branch"].writeCapable).toBe(true);
    expect(SCOPE_DESCRIPTIONS["context:branch"].badgeVariant).toBe("warning");
  });

  it("branch group has a label", () => {
    expect(SCOPE_GROUP_LABELS.branch).toBeTruthy();
  });

  it("groupScopes places context:branch in the branch bucket", () => {
    const groups = groupScopes(parseScopeString("context:read context:branch"));
    expect(groups.branch).toEqual(["context:branch"]);
    expect(groups.read).toEqual(["context:read"]);
    expect(groups.propose).toEqual([]);
    expect(groups.generate).toEqual([]);
  });
});

describe("requireNoBranchTargeting — branch ownership", () => {
  it("allows branch-scope writes to a branch owned by the same client", () => {
    const ctx = oauthCtx({ clientId: "my-client" });
    const branch = { authored_by_client_id: "my-client", created_by: null };
    expect(() =>
      requireNoBranchTargeting(ctx, BRANCH_ID, branch)
    ).not.toThrow();
  });

  it("allows branch-scope writes to a branch created by the same user", () => {
    const ctx = oauthCtx({
      clientId: "other-client",
      userId: "00000000-0000-0000-0000-00000000aaaa",
    });
    const branch = {
      authored_by_client_id: null,
      created_by: "00000000-0000-0000-0000-00000000aaaa",
    };
    expect(() =>
      requireNoBranchTargeting(ctx, BRANCH_ID, branch)
    ).not.toThrow();
  });

  it("rejects writes to a branch owned by another client", () => {
    const ctx = oauthCtx({ clientId: "client-a" });
    const branch = { authored_by_client_id: "client-b", created_by: null };
    expect(() =>
      requireNoBranchTargeting(ctx, BRANCH_ID, branch)
    ).toThrow(BranchTargetingNotAllowedError);
  });

  it("rejects writes when context:branch scope is missing", () => {
    const ctx = oauthCtx({
      scopes: ["context:propose"], // no context:branch
      clientId: "my-client",
    });
    const branch = { authored_by_client_id: "my-client", created_by: null };
    expect(() =>
      requireNoBranchTargeting(ctx, BRANCH_ID, branch)
    ).toThrow(BranchTargetingNotAllowedError);
  });

  it("rejects writes when branch is not provided for ownership check", () => {
    const ctx = oauthCtx({ clientId: "my-client" });
    expect(() =>
      requireNoBranchTargeting(ctx, BRANCH_ID)
    ).toThrow(BranchTargetingNotAllowedError);
  });

  it("still allows null/undefined/empty branch_id regardless of scope", () => {
    const ctx = oauthCtx({ scopes: ["context:read"] }); // no branch scope
    expect(() => requireNoBranchTargeting(ctx, null)).not.toThrow();
    expect(() => requireNoBranchTargeting(ctx, undefined)).not.toThrow();
    expect(() => requireNoBranchTargeting(ctx, "")).not.toThrow();
    expect(() => requireNoBranchTargeting(ctx, "   ")).not.toThrow();
  });

  it("legacy csk_v1_ callers are not gated regardless", () => {
    const ctx: McpAuthContext = {
      source: "legacy_csk",
      userId: null,
      workspaceId: "00000000-0000-0000-0000-00000000bbbb",
      role: null,
      scopes: [],
      allowedBoxIds: new Set(),
      clientId: null,
      connectionId: "conn-1",
      permissionMode: "propose_writes",
      tokenId: "tok-1",
      deprecated: true,
    };
    expect(() =>
      requireNoBranchTargeting(ctx, BRANCH_ID)
    ).not.toThrow();
  });
});

describe("DraftBranch type — authored_by fields", () => {
  it("DraftBranch interface includes authored_by_client_id and authored_by_connection_id", () => {
    // Runtime shape check via a mock object that satisfies the
    // DraftBranch interface. If the interface lacks the new fields,
    // TypeScript compilation of this test will fail.
    const mockBranch: import("@/server/services/branch_service").DraftBranch = {
      id: "b1",
      workspace_id: "w1",
      name: "test",
      description: null,
      base_change_set_id: null,
      created_by: "u1",
      status: "open",
      created_at: new Date().toISOString(),
      promoted_at: null,
      discarded_at: null,
      authored_by_connection_id: null,
      authored_by_client_id: "my-client",
    };
    // Verify the fields exist.
    expect(mockBranch.authored_by_client_id).toBe("my-client");
    expect(mockBranch.authored_by_connection_id).toBeNull();
  });
});
