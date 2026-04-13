import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

vi.mock("@/server/auth/mcp_auth_adapter", () => ({
  resolveMcpRequestAuth: vi.fn(),
  requireScope: vi.fn((ctx, required) => Array.isArray(ctx.scopes) && ctx.scopes.includes(required)),
  requireWrite: vi.fn((ctx) => ctx.role !== "viewer"),
  legacyDeprecationHeaders: vi.fn(() => ({ Deprecation: "true" })),
}));

import { POST } from "@/app/api/mcp/route";
import { resolveMcpRequestAuth } from "@/server/auth/mcp_auth_adapter";

const mockedResolve = vi.mocked(resolveMcpRequestAuth);

function oauthAuth(overrides: Record<string, unknown> = {}) {
  return {
    source: "oauth",
    userId: "u1",
    workspaceId: "w1",
    role: "member",
    scopes: ["context:read"],
    allowedBoxIds: new Set<string>(),
    clientId: "client-1",
    connectionId: "tok-1",
    permissionMode: "read_only",
    tokenId: "tok-1",
    deprecated: false,
    ...overrides,
  };
}

describe("/api/mcp protected-route behavior", () => {
  it("rejects revoked/invalid token resolution", async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const req = new NextRequest("https://x.test/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects insufficient scope on write tool call", async () => {
    mockedResolve.mockResolvedValueOnce(oauthAuth({ scopes: ["context:read"] }) as never);
    const req = new NextRequest("https://x.test/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "create_generated_note", arguments: { folder_id: "f1", title: "t", markdown_content: "x" } },
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.message).toMatch(/required scope/i);
  });

  it("rejects viewer write even with write scope", async () => {
    mockedResolve.mockResolvedValueOnce(
      oauthAuth({ scopes: ["context:generate"], role: "viewer", permissionMode: "generate_in_allowed_folders" }) as never
    );
    const req = new NextRequest("https://x.test/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "create_generated_note", arguments: { folder_id: "f1", title: "t", markdown_content: "x" } },
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.message).toMatch(/viewer role/i);
  });

  it("rejects branch-targeting arguments on OAuth writes", async () => {
    mockedResolve.mockResolvedValueOnce(
      oauthAuth({ scopes: ["context:generate"], role: "member", permissionMode: "generate_in_allowed_folders" }) as never
    );
    const req = new NextRequest("https://x.test/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create_generated_note",
          arguments: { folder_id: "f1", title: "t", markdown_content: "x", branch_id: "br-1" },
        },
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.message).toMatch(/main-only/i);
  });
});
