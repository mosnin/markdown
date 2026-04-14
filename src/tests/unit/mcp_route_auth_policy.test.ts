import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/auth/mcp_auth_adapter", () => ({
  resolveMcpRequestAuth: vi.fn(),
  requireScope: vi.fn((ctx, scope) => ctx.scopes?.includes?.(scope) ?? ctx.auth?.scopes?.includes?.(scope) ?? false),
  requireWrite: vi.fn(() => false),
  legacyDeprecationHeaders: vi.fn(() => ({ Deprecation: "true", Warning: '299 - "deprecated"' })),
}));

import { POST } from "@/app/api/mcp/route";
import { resolveMcpRequestAuth } from "@/server/auth/mcp_auth_adapter";

const mockedResolve = vi.mocked(resolveMcpRequestAuth);

describe("/api/mcp auth policy", () => {
  it("rejects legacy tokens on HTTP MCP endpoint", async () => {
    mockedResolve.mockResolvedValueOnce({
      source: "legacy_csk",
      userId: null,
      workspaceId: "w1",
      role: null,
      scopes: [],
      allowedBoxIds: new Set(),
      clientId: null,
      connectionId: "c1",
      permissionMode: "read_only",
      tokenId: "t1",
      deprecated: true,
    });

    const req = new NextRequest("https://x.test/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(String(body.error?.message ?? body.error)).toMatch(/Legacy csk_v1_/);
  });

  it("serves initialize for valid OAuth context", async () => {
    mockedResolve.mockResolvedValueOnce({
      source: "oauth",
      userId: "u1",
      workspaceId: "w1",
      role: "member",
      scopes: ["context:read"],
      allowedBoxIds: new Set(),
      clientId: "client-1",
      connectionId: "tok-1",
      permissionMode: "read_only",
      tokenId: "tok-1",
      deprecated: false,
    });

    const req = new NextRequest("https://x.test/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.result.serverInfo.name).toBe("context-store");
  });
});
