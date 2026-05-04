import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRedeem = vi.fn();
const mockLookupId = vi.fn();
const mockAssemble = vi.fn();
const mockHydrate = vi.fn();
const mockRender = vi.fn();
const mockGetWorkspace = vi.fn();
const mockAuditPulled = vi.fn();
const mockAuditPulledInvalid = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/server/services/pull_token_service", () => ({
  redeemPullToken: (...args: unknown[]) => mockRedeem(...args),
  lookupPullTokenIdByString: (...args: unknown[]) => mockLookupId(...args),
}));

vi.mock("@/server/services/context_bundle_service", () => ({
  assembleContextBundle: (...args: unknown[]) => mockAssemble(...args),
}));

vi.mock("@/server/services/context_bundle_markdown", () => ({
  hydrateBundleBodies: (...args: unknown[]) => mockHydrate(...args),
  renderBundleMarkdown: (...args: unknown[]) => mockRender(...args),
}));

vi.mock("@/server/repositories/workspace_repository", () => ({
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspace(...args),
}));

vi.mock("@/server/services/audit_service", () => ({
  auditBundlePulled: (...args: unknown[]) => mockAuditPulled(...args),
  auditBundlePulledInvalid: (...args: unknown[]) => mockAuditPulledInvalid(...args),
}));

import { GET } from "@/app/p/n/[token]/route";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeReq(url: string, accept?: string): NextRequest {
  const headers = new Headers({ "user-agent": "agent/1" });
  if (accept) headers.set("accept", accept);
  return new NextRequest(url, { method: "GET", headers });
}

const validRedeem = {
  workspaceId: "ws-1",
  userId: "user-1",
  objectType: "note" as const,
  objectId: "note-1",
  writeCapable: false,
  newExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  expiresInSeconds: 60,
};

const sampleBundle = {
  target_note: {
    id: "note-1",
    title: "Hello",
    path_cache: "/n/hello",
    summary: null,
    tags: [],
    box_id: "box-1",
    folder_id: null,
    kind: "note",
    status: "active",
    read_hint: null,
    retrieval_priority: 0,
    folder_path_cache: null,
    updated_at: new Date().toISOString(),
  },
  box: { id: "box-1", name: "Box", slug: "box", workspace_id: "ws-1", guide_note_id: null },
  parent_path: { folder_ids: [], folder_names: [], path_cache: null },
  guide_note: null,
  linked_notes: [],
  ancestor_summary_note: null,
  relationship_edges: [],
  version_info: {
    current_version_id: null,
    updated_at: new Date().toISOString(),
    version_created_at: null,
    change_origin: null,
  },
  truncated: false,
  truncation_reasons: [],
  assembly_metadata: {
    assembled_at: new Date().toISOString(),
    include_guide: true,
    include_archived: false,
    include_ancestor_summary: true,
    linked_limit: 10,
    total_linked_available: 0,
    include_user_branches: true,
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /p/n/[token]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssemble.mockResolvedValue(sampleBundle);
    mockHydrate.mockResolvedValue(new Map());
    mockRender.mockReturnValue("# rendered markdown");
    mockGetWorkspace.mockResolvedValue({ id: "ws-1", name: "Workspace" });
    mockLookupId.mockResolvedValue("tok-1");
  });

  it("returns 401 when redeem fails", async () => {
    mockRedeem.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/p/n/abc"), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(res.status).toBe(401);
    expect(mockAuditPulledInvalid).toHaveBeenCalled();
  });

  it("returns 415 for non-note object types", async () => {
    mockRedeem.mockResolvedValue({ ...validRedeem, objectType: "box" });
    const res = await GET(makeReq("http://localhost/p/n/abc"), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toMatch(/object_type not yet supported/);
  });

  it("returns markdown when Accept: text/markdown", async () => {
    mockRedeem.mockResolvedValue(validRedeem);
    const res = await GET(
      makeReq("http://localhost/p/n/abc", "text/markdown"),
      { params: Promise.resolve({ token: "abc" }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/markdown/);
    expect(res.headers.get("X-Poggle-Expires-At")).toBe(validRedeem.newExpiresAt);
    const body = await res.text();
    expect(body).toContain("rendered markdown");
    expect(mockAuditPulled).toHaveBeenCalled();
  });

  it("returns markdown when path ends with .md", async () => {
    mockRedeem.mockResolvedValue(validRedeem);
    const res = await GET(makeReq("http://localhost/p/n/abc.md"), {
      params: Promise.resolve({ token: "abc.md" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/markdown/);
    // The redeem should be called with the suffix-stripped token.
    expect(mockRedeem).toHaveBeenCalledWith(expect.anything(), "abc", "agent/1");
  });

  it("returns JSON when Accept: application/json", async () => {
    mockRedeem.mockResolvedValue(validRedeem);
    const res = await GET(
      makeReq("http://localhost/p/n/abc", "application/json"),
      { params: Promise.resolve({ token: "abc" }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.target_note.id).toBe("note-1");
  });

  it("falls back to HTML when no Accept hint matches", async () => {
    mockRedeem.mockResolvedValue(validRedeem);
    const res = await GET(makeReq("http://localhost/p/n/abc"), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/html/);
  });
});
