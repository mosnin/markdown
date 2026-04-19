import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetTemplate = vi.fn();
const mockApplyTemplate = vi.fn();
const mockCreateNoteOnBranch = vi.fn();
const mockBoxMaybeSingle = vi.fn();

const adminMock = {
  from: (_table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        maybeSingle: mockBoxMaybeSingle,
      }),
    }),
  }),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminMock,
}));

vi.mock("@/server/services/note_template_service", () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  applyTemplate: (...args: unknown[]) => mockApplyTemplate(...args),
}));

vi.mock("@/server/services/note_service", () => ({
  createNoteOnBranch: (...args: unknown[]) => mockCreateNoteOnBranch(...args),
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { POST } from "@/app/api/agent/tools/apply_template/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/apply_template", {
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

describe("POST /api/agent/tools/apply_template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid secret with 401", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);
    const res = await POST(
      makeRequest({ template_id: "t", title: "x", box_id: "b" })
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when feature disabled", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
    } as any);
    const res = await POST(
      makeRequest({ template_id: "t", title: "x", box_id: "b" })
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when required fields missing", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const res = await POST(makeRequest({ template_id: "t" }));
    expect(res.status).toBe(400);
  });

  it("creates a note from the template on happy path", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    mockGetTemplate.mockResolvedValue({
      id: "tmpl-1",
      box_id: "box-1",
      workspace_id: okCtx.ctx.workspaceId,
      markdown_content: "Hi {{name}}",
      tags: ["meeting"],
    });
    mockApplyTemplate.mockReturnValue("Hi Alice");
    mockBoxMaybeSingle.mockResolvedValue({
      data: { workspace_id: okCtx.ctx.workspaceId },
      error: null,
    });
    mockCreateNoteOnBranch.mockResolvedValue({
      id: "note-9",
      title: "Standup",
    });

    const res = await POST(
      makeRequest({
        template_id: "tmpl-1",
        title: "Standup",
        box_id: "box-1",
        variables: { name: "Alice" },
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({
      note_id: "note-9",
      title: "Standup",
      branch_id: okCtx.ctx.branchId,
      template_id: "tmpl-1",
    });
    expect(mockApplyTemplate).toHaveBeenCalledWith("Hi {{name}}", { name: "Alice" });
    expect(mockCreateNoteOnBranch).toHaveBeenCalledWith(
      expect.anything(),
      okCtx.ctx.userId,
      okCtx.ctx.workspaceId,
      okCtx.ctx.branchId,
      expect.objectContaining({
        boxId: "box-1",
        title: "Standup",
        markdownContent: "Hi Alice",
        tags: ["meeting"],
      })
    );
  });
});
