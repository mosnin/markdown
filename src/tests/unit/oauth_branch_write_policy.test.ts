import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/auth/get_connection_context", () => ({
  getConnectionContext: vi.fn(),
}));

import { getConnectionContext } from "@/server/auth/get_connection_context";
import { POST as postWriteProposal } from "@/app/api/v1/write_proposals/route";
import { POST as postGeneratedNote } from "@/app/api/v1/generated_notes/route";

const mockedCtx = vi.mocked(getConnectionContext);

const oauthCtx = {
  connection: {
    id: "tok-1",
    workspace_id: "w1",
    name: "oauth:client",
    description: null,
    connection_type: "mcp",
    status: "active",
    permission_mode: "generate_in_allowed_folders",
    last_used_at: null,
    usage_count: 0,
    metadata: { auth_source: "oauth" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  workspaceId: "w1",
  allowedBoxIds: new Set<string>(),
  tokenId: "tok-1",
};

describe("OAuth write branch policy (main-only)", () => {
  it("rejects branch-targeted write_proposals payloads for OAuth callers", async () => {
    mockedCtx.mockResolvedValueOnce(oauthCtx as never);

    const req = new NextRequest("https://x.test/api/v1/write_proposals", {
      method: "POST",
      body: JSON.stringify({ proposal_type: "create_note", branch_id: "br-123" }),
    });

    const res = await postWriteProposal(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.message ?? "")).toMatch(/main-only/i);
  });

  it("rejects branch-targeted generated_notes payloads for OAuth callers", async () => {
    mockedCtx.mockResolvedValueOnce(oauthCtx as never);

    const req = new NextRequest("https://x.test/api/v1/generated_notes", {
      method: "POST",
      body: JSON.stringify({ folder_id: "f1", branch_id: "br-123", markdown_content: "x", title: "t" }),
    });

    const res = await postGeneratedNote(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.message ?? "")).toMatch(/main-only/i);
  });
});
