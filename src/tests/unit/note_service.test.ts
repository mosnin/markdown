import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration-level unit tests for note_service.ts.
 *
 * Covers the two primary note-persistence pipelines:
 *
 *   updateNote (main write):
 *     - Returns updated note on success
 *     - Throws when note is not found
 *     - Throws when note belongs to a different workspace (auth guard)
 *
 *   updateNoteOnBranch (branch write):
 *     - Returns version metadata and creates a version entry on success
 *     - Throws when note is not found
 *     - Throws when note belongs to a different workspace
 *     - Throws when branch is not open / wrong workspace
 *     - Version history created: createNoteVersion called with correct parent
 *
 * Mocking strategy mirrors note_update_safety.test.ts:
 *   - vi.mock the repositories and services that note_service imports
 *   - Construct a minimal SupabaseClient fake using vi.fn() per test
 */

// ─── Mock declarations ────────────────────────────────────────────────────────

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/services/audit_service");
vi.mock("@/server/services/diff_utils");

// updateNoteOnBranch uses dynamic import() for these three — we must mock them
// as static vi.mock() so vitest hoists them above the imports.
vi.mock("@/server/services/branch_service", () => ({
  upsertBranchHead: vi.fn().mockResolvedValue(undefined),
  resolveBranchVersion: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/server/repositories/note_version_repository", () => ({
  getLatestVersionForNote: vi.fn().mockResolvedValue(null),
  createNoteVersion: vi.fn().mockResolvedValue({
    id: "ver-001",
    note_id: "note-001",
    version_number: 1,
    parent_version_id: null,
    title: "Title",
    markdown_content: "content",
    content_bytes: 7,
    actor_type: "user",
    actor_id: "user-001",
    change_origin: "human_edit",
    diff_summary: {},
    created_at: "2026-01-01T00:00:00.000Z",
  }),
}));

vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { updateNote, updateNoteOnBranch } from "@/server/services/note_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as auditService from "@/server/services/audit_service";
import * as diffUtils from "@/server/services/diff_utils";
import * as branchService from "@/server/services/branch_service";
import * as noteVersionRepo from "@/server/repositories/note_version_repository";
import * as auditEventRepo from "@/server/repositories/audit_event_repository";

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-001";
const OTHER_WORKSPACE_ID = "ws-other";
const NOTE_ID = "note-001";
const USER_ID = "user-001";
const BOX_ID = "box-001";
const BRANCH_ID = "branch-001";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    box_id: BOX_ID,
    title: "Original Title",
    markdown_content: "# Original",
    content_bytes: 10,
    summary: null,
    tags: [],
    read_hint: null,
    status: "active",
    kind: "note",
    current_version_id: "ver-000",
    folder_id: null,
    branch_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRpcNote(overrides: Record<string, unknown> = {}) {
  return {
    note: makeNote(overrides),
    version: {
      id: "ver-001",
      note_id: NOTE_ID,
      version_number: 2,
      change_origin: "human_edit",
    },
  };
}

type SupabaseArg = Parameters<typeof updateNote>[0];

/**
 * Build a minimal Supabase fake that:
 *   - supabase.from("boxes").select().eq().maybeSingle() → { data: box, error: null }
 *   - supabase.rpc(...) → rpcResult
 */
function makeSupabase({
  boxWorkspaceId = WORKSPACE_ID,
  rpcResult = { data: makeRpcNote(), error: null } as { data: unknown; error: unknown },
}: {
  boxWorkspaceId?: string | null;
  rpcResult?: { data: unknown; error: unknown };
} = {}): SupabaseArg {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: boxWorkspaceId !== null ? { workspace_id: boxWorkspaceId } : null,
      error: null,
    }),
    single: vi.fn().mockResolvedValue({
      data: boxWorkspaceId !== null ? { workspace_id: boxWorkspaceId } : null,
      error: null,
    }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
  };

  return {
    from: vi.fn().mockReturnValue(chainable),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as SupabaseArg;
}

/**
 * Build a Supabase fake for updateNoteOnBranch where draft_branches are
 * returned as well as boxes.
 */
function makeBranchSupabase({
  boxWorkspaceId = WORKSPACE_ID,
  branchWorkspaceId = WORKSPACE_ID,
  branchStatus = "open",
  branchExists = true,
}: {
  boxWorkspaceId?: string;
  branchWorkspaceId?: string;
  branchStatus?: string;
  branchExists?: boolean;
} = {}): SupabaseArg {
  const selectFn = vi.fn().mockReturnThis();
  const eqFn = vi.fn().mockReturnThis();

  return {
    from: vi.fn((table: string) => {
      if (table === "boxes") {
        return {
          select: selectFn,
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { workspace_id: boxWorkspaceId },
            error: null,
          }),
        };
      }
      if (table === "draft_branches") {
        return {
          select: selectFn,
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: branchExists
              ? { id: BRANCH_ID, workspace_id: branchWorkspaceId, status: branchStatus }
              : null,
            error: null,
          }),
        };
      }
      return {
        select: selectFn,
        eq: eqFn,
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
      };
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as SupabaseArg;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const MOCK_DIFF: import("@/server/services/diff_utils").DiffSummary = {
  title_changed: false,
  body_changed: true,
  summary_changed: false,
  tags_changed: false,
  status_changed: false,
  bytes_added: 4,
  bytes_removed: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditNoteUpdated).mockResolvedValue(undefined as never);
  vi.mocked(auditService.auditNoteCreated).mockResolvedValue(undefined as never);
  vi.mocked(diffUtils.computeDiffSummary).mockReturnValue(MOCK_DIFF);
  vi.mocked(branchService.upsertBranchHead).mockResolvedValue(undefined as never);
  vi.mocked(branchService.resolveBranchVersion).mockResolvedValue(null);
  vi.mocked(noteVersionRepo.getLatestVersionForNote).mockResolvedValue(null);
  vi.mocked(noteVersionRepo.createNoteVersion).mockResolvedValue({
    id: "ver-001",
    note_id: NOTE_ID,
    version_number: 1,
    parent_version_id: null,
    title: "Title",
    markdown_content: "content",
    content_bytes: 7,
    actor_type: "user",
    actor_id: USER_ID,
    change_origin: "human_edit",
    diff_summary: {},
    created_at: "2026-01-01T00:00:00.000Z",
  } as never);
  vi.mocked(auditEventRepo.createAuditEvent).mockResolvedValue(undefined as never);
});

// ─── updateNote tests ─────────────────────────────────────────────────────────

describe("updateNote", () => {
  it("returns the updated note on success", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const updatedNote = makeNote({ title: "New Title", markdown_content: "new body" });
    const supabase = makeSupabase({
      rpcResult: { data: { note: updatedNote, version: { id: "ver-002", version_number: 2 } }, error: null },
    });

    const result = await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title: "New Title",
      markdownContent: "new body",
    });

    expect(result).toMatchObject({ id: NOTE_ID, title: "New Title" });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_note_and_create_version",
      expect.objectContaining({ p_note_id: NOTE_ID, p_title: "New Title", p_markdown_content: "new body" })
    );
  });

  it("throws 'Note not found' when getNoteById returns null", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);
    const supabase = makeSupabase();

    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("Note not found");

    // RPC should never be called
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("throws 'Note not found' when box belongs to a different workspace (auth guard)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ boxWorkspaceId: OTHER_WORKSPACE_ID });

    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("Note not found");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("throws 'Note not found' when box row is missing entirely", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ boxWorkspaceId: null });

    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("Note not found");
  });

  it("throws RPC error message when RPC returns an error", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({
      rpcResult: { data: null, error: { message: "constraint violation" } },
    });

    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("constraint violation");
  });

  it("throws generic message when RPC returns null data with no error", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ rpcResult: { data: null, error: null } });

    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("Failed to update note");
  });

  it("fires an audit event after a successful update", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ rpcResult: { data: makeRpcNote({ title: "Saved" }), error: null } });

    await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title: "Saved",
      markdownContent: "body",
    });

    expect(auditService.auditNoteUpdated).toHaveBeenCalledWith(
      supabase,
      WORKSPACE_ID,
      USER_ID,
      NOTE_ID,
      expect.any(String)
    );
  });
});

// ─── updateNoteOnBranch tests ─────────────────────────────────────────────────

describe("updateNoteOnBranch", () => {
  it("returns version metadata on success", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(noteVersionRepo.createNoteVersion).mockResolvedValue({
      id: "ver-001",
      note_id: NOTE_ID,
      version_number: 1,
      parent_version_id: null,
      title: "Title",
      markdown_content: "content",
      content_bytes: 7,
      actor_type: "user",
      actor_id: USER_ID,
      change_origin: "human_edit",
      diff_summary: {},
      created_at: "2026-01-01T00:00:00.000Z",
    } as never);
    const supabase = makeBranchSupabase();

    const result = await updateNoteOnBranch(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      BRANCH_ID,
      NOTE_ID,
      { title: "Title", markdownContent: "content" }
    );

    expect(result).toMatchObject({
      version_id: "ver-001",
      version_number: 1,
      branch_id: BRANCH_ID,
      note_id: NOTE_ID,
    });
  });

  it("creates a version entry (version history creation on save)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeBranchSupabase();

    await updateNoteOnBranch(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      BRANCH_ID,
      NOTE_ID,
      { title: "Updated", markdownContent: "new body" }
    );

    expect(noteVersionRepo.createNoteVersion).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        note_id: NOTE_ID,
        title: "Updated",
        markdown_content: "new body",
        actor_id: USER_ID,
        actor_type: "user",
        change_origin: "human_edit",
      })
    );
  });

  it("uses the existing branch head as parent version when a prior branch edit exists", async () => {
    const BRANCH_HEAD_VERSION = "ver-branch-head-5";
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(branchService.resolveBranchVersion).mockResolvedValue(BRANCH_HEAD_VERSION);
    const supabase = makeBranchSupabase();

    await updateNoteOnBranch(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      BRANCH_ID,
      NOTE_ID,
      { title: "T", markdownContent: "c" }
    );

    expect(noteVersionRepo.createNoteVersion).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ parent_version_id: BRANCH_HEAD_VERSION })
    );
  });

  it("uses main's current_version_id as parent when no prior branch head exists", async () => {
    const MAIN_HEAD = "ver-000";
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeNote({ current_version_id: MAIN_HEAD }) as never
    );
    vi.mocked(branchService.resolveBranchVersion).mockResolvedValue(null);
    const supabase = makeBranchSupabase();

    await updateNoteOnBranch(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      BRANCH_ID,
      NOTE_ID,
      { title: "T", markdownContent: "c" }
    );

    expect(noteVersionRepo.createNoteVersion).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ parent_version_id: MAIN_HEAD })
    );
  });

  it("advances version_number to latest + 1", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(noteVersionRepo.getLatestVersionForNote).mockResolvedValue({
      version_number: 7,
    } as never);
    const supabase = makeBranchSupabase();

    await updateNoteOnBranch(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      BRANCH_ID,
      NOTE_ID,
      { title: "T", markdownContent: "c" }
    );

    expect(noteVersionRepo.createNoteVersion).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ version_number: 8 })
    );
  });

  it("throws 'Note not found' when getNoteById returns null", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);
    const supabase = makeBranchSupabase();

    await expect(
      updateNoteOnBranch(supabase, USER_ID, WORKSPACE_ID, BRANCH_ID, NOTE_ID, {
        title: "T",
        markdownContent: "c",
      })
    ).rejects.toThrow("Note not found");

    expect(noteVersionRepo.createNoteVersion).not.toHaveBeenCalled();
  });

  it("throws 'Note not found' when note belongs to a different workspace (auth guard)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeBranchSupabase({ boxWorkspaceId: OTHER_WORKSPACE_ID });

    await expect(
      updateNoteOnBranch(supabase, USER_ID, WORKSPACE_ID, BRANCH_ID, NOTE_ID, {
        title: "T",
        markdownContent: "c",
      })
    ).rejects.toThrow("Note not found");

    expect(noteVersionRepo.createNoteVersion).not.toHaveBeenCalled();
  });

  it("throws when the branch does not exist", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeBranchSupabase({ branchExists: false });

    await expect(
      updateNoteOnBranch(supabase, USER_ID, WORKSPACE_ID, BRANCH_ID, NOTE_ID, {
        title: "T",
        markdownContent: "c",
      })
    ).rejects.toThrow("Branch not found or not open");
  });

  it("throws when the branch belongs to a different workspace (unauthorized)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeBranchSupabase({ branchWorkspaceId: OTHER_WORKSPACE_ID });

    await expect(
      updateNoteOnBranch(supabase, USER_ID, WORKSPACE_ID, BRANCH_ID, NOTE_ID, {
        title: "T",
        markdownContent: "c",
      })
    ).rejects.toThrow("Branch not found or not open");
  });

  it("throws when the branch is not in 'open' status", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeBranchSupabase({ branchStatus: "merged" });

    await expect(
      updateNoteOnBranch(supabase, USER_ID, WORKSPACE_ID, BRANCH_ID, NOTE_ID, {
        title: "T",
        markdownContent: "c",
      })
    ).rejects.toThrow("Branch not found or not open");
  });

  it("upserts the branch head after creating the version", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeBranchSupabase();

    await updateNoteOnBranch(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      BRANCH_ID,
      NOTE_ID,
      { title: "T", markdownContent: "c" }
    );

    expect(branchService.upsertBranchHead).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        branch_id: BRANCH_ID,
        object_type: "note",
        object_id: NOTE_ID,
        version_id: "ver-001",
      })
    );
  });

  it("fires a branch audit event after a successful branch write", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeBranchSupabase();

    await updateNoteOnBranch(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      BRANCH_ID,
      NOTE_ID,
      { title: "T", markdownContent: "c" }
    );

    expect(auditEventRepo.createAuditEvent).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        actor_id: USER_ID,
        object_id: NOTE_ID,
        event_type: "note.branch_updated",
      })
    );
  });
});
