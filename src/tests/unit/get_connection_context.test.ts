import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/auth/mcp_auth_adapter", () => ({
  resolveMcpRequestAuth: vi.fn(),
}));

const updateMock = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) }));
const fromMock = vi.fn(() => ({ update: updateMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}));

import { getConnectionContext } from "@/server/auth/get_connection_context";
import { resolveMcpRequestAuth } from "@/server/auth/mcp_auth_adapter";

const mockedResolve = vi.mocked(resolveMcpRequestAuth);

describe("getConnectionContext", () => {
  it("returns null when unified resolver rejects auth", async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const ctx = await getConnectionContext(new Request("https://x.test"));
    expect(ctx).toBeNull();
  });

  it("clamps OAuth viewer to read_only permission mode", async () => {
    mockedResolve.mockResolvedValueOnce({
      source: "oauth",
      userId: "u1",
      workspaceId: "w1",
      role: "viewer",
      scopes: ["context:propose"],
      allowedBoxIds: new Set(["b1"]),
      clientId: "client-1",
      connectionId: "tok-1",
      permissionMode: "propose_writes",
      tokenId: "tok-1",
      deprecated: false,
    });

    const ctx = await getConnectionContext(new Request("https://x.test"));
    expect(ctx?.connection.permission_mode).toBe("read_only");
  });

  it("preserves OAuth non-viewer permission mode", async () => {
    mockedResolve.mockResolvedValueOnce({
      source: "oauth",
      userId: "u1",
      workspaceId: "w1",
      role: "member",
      scopes: ["context:propose"],
      allowedBoxIds: new Set(["b1"]),
      clientId: "client-1",
      connectionId: "tok-1",
      permissionMode: "propose_writes",
      tokenId: "tok-1",
      deprecated: false,
    });

    const ctx = await getConnectionContext(new Request("https://x.test"));
    expect(ctx?.connection.permission_mode).toBe("propose_writes");
  });
});
