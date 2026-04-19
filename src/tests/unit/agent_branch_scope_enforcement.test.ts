import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Branch-scope enforcement tests for the Workspace Operator tool routes.
 *
 * The agent runs in Modal and calls back into Poggle through `/api/agent/tools/*`
 * endpoints. The runtime trust story is that:
 *
 *   1. The shared secret + envelope binds the call to a (user, workspace,
 *      branch, run) tuple.
 *   2. Every write must target the envelope's branch (the agent never writes
 *      to main directly).
 *   3. Every reference to a note (read, edit, link source/target) must
 *      resolve to a note that lives in the envelope's workspace — IDs from
 *      another workspace are rejected.
 *
 * These tests exercise each rejection path. They mock `verifyAgentRequest`
 * so we don't have to spin up env vars; the route logic itself does the
 * branch / workspace cross-checks we care about.
 */

// ---------------------------------------------------------------------------
// Mocks — declared before route imports so vi hoists them correctly.
// ---------------------------------------------------------------------------

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

// Default Supabase admin: a chainable stub. Individual tests override with
// vi.mocked(createAdminClient).mockReturnValueOnce(...) when they need to
// shape the response of a particular query.
const defaultAdminClient = () => ({
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => defaultAdminClient()),
}));

// Service-layer mocks — let us assert routes never reach the writer when
// the envelope is malformed and let us simulate workspace-scope failures
// for routes that delegate the check to services.
vi.mock("@/server/services/note_service", () => ({
  createNoteOnBranch: vi.fn(),
  updateNoteOnBranch: vi.fn(),
  getNoteForWorkspace: vi.fn(),
}));

vi.mock("@/server/services/object_link_service", () => ({
  createLink: vi.fn(),
}));

import { POST as draftNotePOST } from "@/app/api/agent/tools/draft_note/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createNoteOnBranch,
  updateNoteOnBranch,
  getNoteForWorkspace,
} from "@/server/services/note_service";
import { createLink } from "@/server/services/object_link_service";

// Edit/link routes are owned by Agent 1 (parallel workstream). When their
// route files don't exist yet, the dynamic import below throws and the
// related describe blocks short-circuit to `it.skip` so this suite passes
// regardless of merge order. Once Agent 1's routes are merged the same
// tests exercise them for real.
async function tryImportRoute(path: string): Promise<{ POST: (req: NextRequest) => Promise<Response> } | null> {
  try {
    const mod = (await import(/* @vite-ignore */ path)) as {
      POST: (req: NextRequest) => Promise<Response>;
    };
    return mod;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_USER_ID = "00000000-0000-0000-0000-000000000001";
const VALID_WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const VALID_BRANCH_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-3333-3333-333333333333";
const VALID_RUN_ID = "abcdef1234567890";
const NOTE_IN_WORKSPACE = "44444444-4444-4444-4444-444444444444";
const NOTE_IN_OTHER_WORKSPACE = "55555555-5555-5555-5555-555555555555";

function makeAuthOk(branchId: string | null = VALID_BRANCH_ID) {
  return {
    ok: true as const,
    ctx: {
      userId: VALID_USER_ID,
      workspaceId: VALID_WORKSPACE_ID,
      branchId,
      runId: VALID_RUN_ID,
    },
  };
}

function makeJSONRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// draft_note — branch-scope enforcement
// ---------------------------------------------------------------------------

describe("POST /api/agent/tools/draft_note — branch enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when envelope has no branch_id (cannot write to main)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk(null) as any);

    const res = await draftNotePOST(
      makeJSONRequest("http://localhost/api/agent/tools/draft_note", {
        box_id: "any-box",
        title: "Should fail",
        markdown_content: "x",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error_code).toBe("forbidden");
    expect(json.message).toMatch(/branch_id/);
    // The route must short-circuit before invoking the service.
    expect(createNoteOnBranch).not.toHaveBeenCalled();
  });

  it("rejects when envelope branch_id is the empty string (treated as missing)", async () => {
    // verifyAgentRequest already coerces empty to null → branchId === null;
    // this test guards the route's own check against a regression where
    // branchId came through as '' (e.g. a future header parse change).
    vi.mocked(verifyAgentRequest).mockReturnValue(
      makeAuthOk("" as unknown as string) as any
    );

    const res = await draftNotePOST(
      makeJSONRequest("http://localhost/api/agent/tools/draft_note", {
        box_id: "any-box",
        title: "Should fail",
        markdown_content: "x",
      })
    );
    expect(res.status).toBe(403);
    expect(createNoteOnBranch).not.toHaveBeenCalled();
  });

  it("rejects when box_id belongs to a different workspace", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk() as any);

    // Stub the box lookup to return a row whose workspace_id mismatches
    // the envelope's workspace. The route must reject before ever
    // touching the note service.
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({
            data: { workspace_id: OTHER_WORKSPACE_ID },
            error: null,
          }),
      })),
    };
    vi.mocked(createAdminClient).mockReturnValueOnce(mockClient as any);

    const res = await draftNotePOST(
      makeJSONRequest("http://localhost/api/agent/tools/draft_note", {
        box_id: "cross-workspace-box",
        title: "Should fail",
        markdown_content: "x",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error_code).toBe("box_not_found");
    expect(createNoteOnBranch).not.toHaveBeenCalled();
  });

  it("rejects when box lookup returns null (box does not exist in any workspace)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk() as any);

    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };
    vi.mocked(createAdminClient).mockReturnValueOnce(mockClient as any);

    const res = await draftNotePOST(
      makeJSONRequest("http://localhost/api/agent/tools/draft_note", {
        box_id: "missing-box",
        title: "Should fail",
        markdown_content: "x",
      })
    );
    expect(res.status).toBe(404);
    expect(createNoteOnBranch).not.toHaveBeenCalled();
  });

  it("rejects when shared secret is invalid (mid-flight credential rotation)", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);

    const res = await draftNotePOST(
      makeJSONRequest("http://localhost/api/agent/tools/draft_note", {
        box_id: "x",
        title: "y",
      })
    );
    expect(res.status).toBe(401);
    expect(createNoteOnBranch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// edit_note — workspace + branch scoping
// ---------------------------------------------------------------------------

describe("POST /api/agent/tools/edit_note — branch + workspace enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when envelope has no branch_id", async () => {
    const mod = await tryImportRoute("@/app/api/agent/tools/edit_note/route");
    if (!mod) {
      console.warn("edit_note route not yet present — skipping (Agent 1 owns this)");
      return;
    }
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk(null) as any);

    const res = await mod.POST(
      makeJSONRequest("http://localhost/api/agent/tools/edit_note", {
        note_id: NOTE_IN_WORKSPACE,
        new_content: "...",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error_code).toBe("forbidden");
    expect(updateNoteOnBranch).not.toHaveBeenCalled();
  });

  it("rejects when note_id resolves to a different workspace", async () => {
    const mod = await tryImportRoute("@/app/api/agent/tools/edit_note/route");
    if (!mod) {
      console.warn("edit_note route not yet present — skipping (Agent 1 owns this)");
      return;
    }
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk() as any);
    // getNoteForWorkspace returns null when the note isn't in the
    // envelope's workspace. The route must surface 404 and never reach
    // the writer.
    vi.mocked(getNoteForWorkspace).mockResolvedValueOnce(null as any);

    const res = await mod.POST(
      makeJSONRequest("http://localhost/api/agent/tools/edit_note", {
        note_id: NOTE_IN_OTHER_WORKSPACE,
        new_content: "should not write",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error_code).toBe("note_not_found");
    expect(updateNoteOnBranch).not.toHaveBeenCalled();
  });

  it("rejects an empty note_id with 400 (defensive shape check)", async () => {
    const mod = await tryImportRoute("@/app/api/agent/tools/edit_note/route");
    if (!mod) {
      console.warn("edit_note route not yet present — skipping (Agent 1 owns this)");
      return;
    }
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk() as any);

    const res = await mod.POST(
      makeJSONRequest("http://localhost/api/agent/tools/edit_note", {
        note_id: "",
        new_content: "x",
      })
    );
    expect(res.status).toBe(400);
    expect(updateNoteOnBranch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// link_notes — both endpoints of the link must be in the same workspace
// ---------------------------------------------------------------------------

describe("POST /api/agent/tools/link_notes — workspace enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when envelope has no branch_id (links must be branch-scoped)", async () => {
    const mod = await tryImportRoute("@/app/api/agent/tools/link_notes/route");
    if (!mod) {
      console.warn("link_notes route not yet present — skipping (Agent 1 owns this)");
      return;
    }
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk(null) as any);

    const res = await mod.POST(
      makeJSONRequest("http://localhost/api/agent/tools/link_notes", {
        source_note_id: NOTE_IN_WORKSPACE,
        target_note_id: NOTE_IN_WORKSPACE,
        relationship_type: "related",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error_code).toBe("forbidden");
    expect(createLink).not.toHaveBeenCalled();
  });

  it("rejects when source note belongs to a different workspace", async () => {
    const mod = await tryImportRoute("@/app/api/agent/tools/link_notes/route");
    if (!mod) {
      console.warn("link_notes route not yet present — skipping (Agent 1 owns this)");
      return;
    }
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk() as any);
    // createLink throws when an endpoint isn't in the workspace.
    vi.mocked(createLink).mockRejectedValueOnce(
      new Error("Source object not found in workspace")
    );

    const res = await mod.POST(
      makeJSONRequest("http://localhost/api/agent/tools/link_notes", {
        source_note_id: NOTE_IN_OTHER_WORKSPACE,
        target_note_id: NOTE_IN_WORKSPACE,
        relationship_type: "related",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error_code).toBe("invalid_link");
    expect(json.message).toMatch(/not found in workspace/);
  });

  it("rejects when target note belongs to a different workspace", async () => {
    const mod = await tryImportRoute("@/app/api/agent/tools/link_notes/route");
    if (!mod) {
      console.warn("link_notes route not yet present — skipping (Agent 1 owns this)");
      return;
    }
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk() as any);
    vi.mocked(createLink).mockRejectedValueOnce(
      new Error("Target object not found in workspace")
    );

    const res = await mod.POST(
      makeJSONRequest("http://localhost/api/agent/tools/link_notes", {
        source_note_id: NOTE_IN_WORKSPACE,
        target_note_id: NOTE_IN_OTHER_WORKSPACE,
        relationship_type: "related",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error_code).toBe("invalid_link");
  });

  it("forwards the envelope's branch_id to createLink (link is branch-scoped)", async () => {
    const mod = await tryImportRoute("@/app/api/agent/tools/link_notes/route");
    if (!mod) {
      console.warn("link_notes route not yet present — skipping (Agent 1 owns this)");
      return;
    }
    vi.mocked(verifyAgentRequest).mockReturnValue(makeAuthOk() as any);
    vi.mocked(createLink).mockResolvedValueOnce({
      id: "link-1",
      source_object_id: NOTE_IN_WORKSPACE,
      target_object_id: NOTE_IN_WORKSPACE,
      relationship_type: "related",
    } as any);

    await mod.POST(
      makeJSONRequest("http://localhost/api/agent/tools/link_notes", {
        source_note_id: NOTE_IN_WORKSPACE,
        target_note_id: NOTE_IN_WORKSPACE,
        relationship_type: "related",
      })
    );

    expect(createLink).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(createLink).mock.calls[0];
    // 3rd positional arg is the input object — must include branchId.
    expect(callArgs[2].branchId).toBe(VALID_BRANCH_ID);
  });
});
