import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  legacyCskEnabled,
  legacyDeprecationHeaders,
  requireScope,
  requireWrite,
  type McpAuthContext,
} from "@/server/auth/mcp_auth_adapter";

/**
 * Pure-unit tests for the MCP auth adapter.
 *
 * The DB-backed paths (resolveMcpRequestAuth against real Supabase)
 * are covered by integration tests; this file covers the pure
 * decision logic — env-flag gating, header shape, and the scope /
 * role guards.
 */

describe("mcp_auth_adapter — env gating", () => {
  const original = process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED;
  beforeEach(() => {
    delete process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED;
  });
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED;
    } else {
      process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED = original;
    }
  });

  it("legacyCskEnabled is false when the env var is unset", () => {
    expect(legacyCskEnabled()).toBe(false);
  });

  it("legacyCskEnabled is false when the env var is 'false'", () => {
    process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED = "false";
    expect(legacyCskEnabled()).toBe(false);
  });

  it("legacyCskEnabled is false for truthy-but-not-'true' values", () => {
    process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED = "1";
    expect(legacyCskEnabled()).toBe(false);
    process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED = "yes";
    expect(legacyCskEnabled()).toBe(false);
  });

  it("legacyCskEnabled is true ONLY for the exact string 'true'", () => {
    process.env.CONTEXT_STORE_LEGACY_CSK_ENABLED = "true";
    expect(legacyCskEnabled()).toBe(true);
  });
});

describe("mcp_auth_adapter — deprecation header shape", () => {
  it("sets Deprecation: true", () => {
    const h = legacyDeprecationHeaders();
    expect(h["Deprecation"]).toBe("true");
  });

  it("includes a Link relation pointing at the migration doc", () => {
    const h = legacyDeprecationHeaders();
    expect(h["Link"]).toMatch(/rel="deprecation"/);
  });

  it("includes a Warning header that names the successor flow", () => {
    const h = legacyDeprecationHeaders();
    expect(h["Warning"]).toMatch(/OAuth/);
    expect(h["Warning"]).toMatch(/authorize/);
  });
});

// ─── Scope guard tests ───────────────────────────────────────────────────────

function oauthCtx(overrides: Partial<McpAuthContext> = {}): McpAuthContext {
  return {
    source: "oauth",
    userId: "00000000-0000-0000-0000-00000000aaaa",
    workspaceId: "00000000-0000-0000-0000-00000000bbbb",
    role: "member",
    scopes: ["context:read"],
    allowedBoxIds: new Set(),
    clientId: "demo-client",
    connectionId: "tok-1",
    permissionMode: "read_only",
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
    connectionId: "conn-1",
    permissionMode: "read_only",
    tokenId: "tok-legacy-1",
    deprecated: true,
    ...overrides,
  };
}

describe("mcp_auth_adapter — requireScope", () => {
  it("allows when the OAuth context has the required capability", () => {
    expect(requireScope(oauthCtx({ scopes: ["context:read"] }), "context:read")).toBe(
      true
    );
  });

  it("blocks when the OAuth context lacks the required capability", () => {
    expect(
      requireScope(oauthCtx({ scopes: ["context:read"] }), "context:propose")
    ).toBe(false);
  });

  it("short-circuits true for legacy_csk (pre-scope era)", () => {
    expect(requireScope(legacyCtx(), "context:generate")).toBe(true);
  });
});

describe("mcp_auth_adapter — requireWrite", () => {
  it("blocks viewers regardless of scope", () => {
    expect(
      requireWrite(
        oauthCtx({ role: "viewer", scopes: ["context:propose"] })
      )
    ).toBe(false);
  });

  it("allows members", () => {
    expect(requireWrite(oauthCtx({ role: "member" }))).toBe(true);
  });

  it("allows admins and owners", () => {
    expect(requireWrite(oauthCtx({ role: "admin" }))).toBe(true);
    expect(requireWrite(oauthCtx({ role: "owner" }))).toBe(true);
  });

  it("legacy read_only is blocked from writing", () => {
    expect(requireWrite(legacyCtx({ permissionMode: "read_only" }))).toBe(false);
  });

  it("legacy propose_writes is allowed through", () => {
    expect(
      requireWrite(legacyCtx({ permissionMode: "propose_writes" }))
    ).toBe(true);
  });

  it("legacy generate_in_allowed_folders is allowed through", () => {
    expect(
      requireWrite(
        legacyCtx({ permissionMode: "generate_in_allowed_folders" })
      )
    ).toBe(true);
  });
});

describe("mcp_auth_adapter — McpAuthContext invariants", () => {
  it("oauth context always names a clientId", () => {
    const ctx = oauthCtx();
    expect(ctx.source).toBe("oauth");
    expect(ctx.clientId).toBeTruthy();
  });

  it("legacy context never has a clientId or userId", () => {
    const ctx = legacyCtx();
    expect(ctx.source).toBe("legacy_csk");
    expect(ctx.clientId).toBeNull();
    expect(ctx.userId).toBeNull();
  });

  it("legacy context is always marked deprecated", () => {
    expect(legacyCtx().deprecated).toBe(true);
  });

  it("oauth context is not marked deprecated by default", () => {
    expect(oauthCtx().deprecated).toBe(false);
  });
});
