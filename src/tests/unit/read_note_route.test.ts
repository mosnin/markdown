import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetNoteForWorkspace = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/server/services/note_service", () => ({
  getNoteForWorkspace: (...args: unknown[]) => mockGetNoteForWorkspace(...args),
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { POST } from "@/app/api/agent/tools/read_note/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/read_note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const okCtx = {
  ok: true,
  ctx: {
    userId: "00000000-0000-0000-0000-000000000001",
    workspaceId: "11111111-1111-1111-1111-111111111111",
    branchId: "22222222-2222-2222-2222-222222222222",
    runId: "abcdef1234567890",
  },
};

describe("POST /api/agent/tools/read_note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid secret with 401", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);
    const res = await POST(makeRequest({ note_id: "n" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error_code).toBe("unauthorized");
  });

  it("returns 404 with feature_disabled when flag is off", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
    } as any);
    const res = await POST(makeRequest({ note_id: "n" }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error_code).toBe("feature_disabled");
  });

  it("returns 400 when note_id is missing", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("bad_request");
  });

  it("returns the note's branch-overlay content on happy path", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    mockGetNoteForWorkspace.mockResolvedValue({
      id: "note-1",
      title: "Quarter Plan",
      markdown_content: "body",
      current_version_id: "ver-3",
      summary: null,
      tags: [],
    });

    const res = await POST(makeRequest({ note_id: "note-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({
      note_id: "note-1",
      title: "Quarter Plan",
      content: "body",
      branch_id: okCtx.ctx.branchId,
      version: "ver-3",
    });
    // Verify that getNoteForWorkspace was called with workspaceId + branchId
    expect(mockGetNoteForWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      "note-1",
      okCtx.ctx.workspaceId,
      okCtx.ctx.branchId
    );
  });
});
