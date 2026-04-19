import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockUpdateNoteOnBranch = vi.fn();
const mockGetNoteForWorkspace = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/server/services/note_service", () => ({
  updateNoteOnBranch: (...args: unknown[]) => mockUpdateNoteOnBranch(...args),
  getNoteForWorkspace: (...args: unknown[]) => mockGetNoteForWorkspace(...args),
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { POST } from "@/app/api/agent/tools/edit_note/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/edit_note", {
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

describe("POST /api/agent/tools/edit_note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid secret with 401", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);
    const res = await POST(makeRequest({ note_id: "n", new_content: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when feature disabled", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
    } as any);
    const res = await POST(makeRequest({ note_id: "n", new_content: "x" }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error_code).toBe("feature_disabled");
  });

  it("returns 403 when branch_id is missing from envelope", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: true,
      ctx: { ...okCtx.ctx, branchId: null },
    } as any);
    const res = await POST(makeRequest({ note_id: "n", new_content: "x" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when note_id missing", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const res = await POST(makeRequest({ new_content: "x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when new_content missing", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const res = await POST(makeRequest({ note_id: "n" }));
    expect(res.status).toBe(400);
  });

  it("returns version metadata on happy path", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    mockGetNoteForWorkspace.mockResolvedValue({
      id: "note-1",
      title: "Original",
      markdown_content: "old",
      summary: null,
      tags: ["t"],
    });
    mockUpdateNoteOnBranch.mockResolvedValue({
      version_id: "ver-9",
      version_number: 4,
      branch_id: okCtx.ctx.branchId,
      note_id: "note-1",
    });

    const res = await POST(
      makeRequest({
        note_id: "note-1",
        new_content: "new body",
        edit_summary: "Refactored",
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({
      note_id: "note-1",
      branch_id: okCtx.ctx.branchId,
      version_id: "ver-9",
      version_number: 4,
    });
    expect(mockUpdateNoteOnBranch).toHaveBeenCalledWith(
      expect.anything(),
      okCtx.ctx.userId,
      okCtx.ctx.workspaceId,
      okCtx.ctx.branchId,
      "note-1",
      expect.objectContaining({ markdownContent: "new body", title: "Original" })
    );
  });
});
