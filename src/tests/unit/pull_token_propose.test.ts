import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRedeem = vi.fn();
const mockLookupId = vi.fn();
const mockCreateProposal = vi.fn();
const mockAuditPulled = vi.fn();
const mockAuditPulledInvalid = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "conn-1", workspace_id: "ws-1" },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/server/services/pull_token_service", () => ({
  redeemPullToken: (...args: unknown[]) => mockRedeem(...args),
  lookupPullTokenIdByString: (...args: unknown[]) => mockLookupId(...args),
}));

vi.mock("@/server/services/audit_service", () => ({
  auditBundlePulled: (...args: unknown[]) => mockAuditPulled(...args),
  auditBundlePulledInvalid: (...args: unknown[]) => mockAuditPulledInvalid(...args),
}));

vi.mock("@/server/services/write_proposal_service", () => ({
  createProposal: (...args: unknown[]) => mockCreateProposal(...args),
}));

import { POST } from "@/app/p/n/[token]/propose/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/p/n/abc/propose", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "agent/1",
    },
    body: JSON.stringify(body),
  });
}

const writeRedeem = {
  workspaceId: "ws-1",
  userId: "user-1",
  objectType: "note" as const,
  objectId: "note-1",
  writeCapable: true,
  newExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  expiresInSeconds: 60,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /p/n/[token]/propose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateProposal.mockResolvedValue({ id: "prop-1" });
    mockLookupId.mockResolvedValue("tok-1");
  });

  it("returns 401 when token redeem fails", async () => {
    mockRedeem.mockResolvedValue(null);
    const res = await POST(makeReq({ kind: "update_note", payload: { content: "x" } }), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(res.status).toBe(401);
    expect(mockAuditPulledInvalid).toHaveBeenCalled();
  });

  it("returns 403 when token is read-only", async () => {
    mockRedeem.mockResolvedValue({ ...writeRedeem, writeCapable: false });
    const res = await POST(makeReq({ kind: "update_note", payload: { content: "x" } }), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 on invalid kind", async () => {
    mockRedeem.mockResolvedValue(writeRedeem);
    const res = await POST(makeReq({ kind: "delete_note", payload: {} }), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when payload missing", async () => {
    mockRedeem.mockResolvedValue(writeRedeem);
    const res = await POST(makeReq({ kind: "update_note" }), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 + proposalId on update_note happy path", async () => {
    mockRedeem.mockResolvedValue(writeRedeem);
    const res = await POST(
      makeReq({ kind: "update_note", payload: { content: "new body" } }),
      { params: Promise.resolve({ token: "abc" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.proposalId).toBe("prop-1");
    expect(mockCreateProposal).toHaveBeenCalled();
    // Audit fired for the write redemption.
    expect(mockAuditPulled).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "user-1",
      "note-1",
      expect.objectContaining({ mode: "write", token_id: "tok-1" })
    );
  });

  it("maps append_to_note kind to append_note proposal_type", async () => {
    mockRedeem.mockResolvedValue(writeRedeem);
    const res = await POST(
      makeReq({ kind: "append_to_note", payload: { content: "more" } }),
      { params: Promise.resolve({ token: "abc" }) }
    );
    expect(res.status).toBe(200);
    expect(mockCreateProposal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        proposal_type: "append_note",
        target_note_id: "note-1",
      })
    );
  });

  it("returns 400 when create_note has no folder_id", async () => {
    mockRedeem.mockResolvedValue(writeRedeem);
    const res = await POST(
      makeReq({ kind: "create_note", payload: { title: "x", content: "y" } }),
      { params: Promise.resolve({ token: "abc" }) }
    );
    expect(res.status).toBe(400);
  });
});
