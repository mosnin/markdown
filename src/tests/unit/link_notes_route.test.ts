import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockCreateLink = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/server/services/object_link_service", () => ({
  createLink: (...args: unknown[]) => mockCreateLink(...args),
}));

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { POST } from "@/app/api/agent/tools/link_notes/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/link_notes", {
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

describe("POST /api/agent/tools/link_notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid secret with 401", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);
    const res = await POST(
      makeRequest({
        source_note_id: "a",
        target_note_id: "b",
        relationship_type: "related",
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when feature disabled", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
    } as any);
    const res = await POST(
      makeRequest({
        source_note_id: "a",
        target_note_id: "b",
        relationship_type: "related",
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when fields missing", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const res = await POST(makeRequest({ source_note_id: "a" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when relationship_type is not in vocabulary", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const res = await POST(
      makeRequest({
        source_note_id: "a",
        target_note_id: "b",
        relationship_type: "frobnicates",
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toMatch(/relationship_type/);
  });

  it("creates a branch-scoped link on happy path", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    mockCreateLink.mockResolvedValue({
      id: "link-7",
      source_object_id: "a",
      target_object_id: "b",
      relationship_type: "reference_for",
    });

    const res = await POST(
      makeRequest({
        source_note_id: "a",
        target_note_id: "b",
        relationship_type: "reference_for",
        relationship_note: "cited",
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({
      link_id: "link-7",
      source_note_id: "a",
      target_note_id: "b",
      relationship_type: "reference_for",
      branch_id: okCtx.ctx.branchId,
    });
    expect(mockCreateLink).toHaveBeenCalledWith(
      expect.anything(),
      okCtx.ctx.workspaceId,
      expect.objectContaining({
        sourceObjectType: "note",
        targetObjectType: "note",
        branchId: okCtx.ctx.branchId,
        relationshipType: "reference_for",
      })
    );
  });
});
