import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for note update safety in note_service.ts (updateNote).
 *
 * Covers:
 * - Content stored verbatim: RPC receives exact input strings, no transformation
 * - Diff computed from prior note state before overwrite
 * - Graceful handling when current note is missing (diff skipped, not thrown)
 * - RPC error propagation
 */

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/services/audit_service");
vi.mock("@/server/services/diff_utils");

import { updateNote } from "@/server/services/note_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as auditService from "@/server/services/audit_service";
import * as diffUtils from "@/server/services/diff_utils";

const WORKSPACE_ID = "ws-001";
const NOTE_ID = "note-001";
const USER_ID = "user-001";
const BOX_ID = "box-001";

/** Minimal mock of SupabaseClient with RPC support. */
function makeSupabase(
  rpcResult: { data: unknown; error: unknown } = { data: null, error: null },
  ownerWorkspaceId: string = WORKSPACE_ID
) {
  // Defense-in-depth: updateNote verifies the note's box belongs to the
  // caller's workspace via `from("boxes").select("workspace_id").eq("id", boxId)
  // .maybeSingle()` before invoking the RPC. Provide a chainable stub that
  // resolves that lookup to an owning box.
  const boxesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { workspace_id: ownerWorkspaceId }, error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(boxesChain),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as Parameters<typeof updateNote>[0];
}

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    box_id: BOX_ID,
    title: "Original Title",
    markdown_content: "# Original",
    content_bytes: 12,
    summary: null,
    tags: [],
    read_hint: null,
    status: "active",
    kind: "note",
    current_version_id: "version-001",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRpcNote(overrides: Record<string, unknown> = {}) {
  return {
    note: makeNote(overrides),
    version: {
      id: "version-002",
      note_id: NOTE_ID,
      version_number: 2,
      change_origin: "user_edit",
    },
  };
}

const MOCK_DIFF: import("@/server/services/diff_utils").DiffSummary = {
  title_changed: true,
  body_changed: false,
  summary_changed: false,
  tags_changed: false,
  status_changed: false,
  bytes_added: 5,
  bytes_removed: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditNoteUpdated).mockResolvedValue(undefined as never);
  vi.mocked(diffUtils.computeDiffSummary).mockReturnValue(MOCK_DIFF);
});

// ─── Content stored verbatim ──────────────────────────────────────────────────

describe("updateNote — content verbatim", () => {
  it("passes title and markdownContent to RPC without transformation", async () => {
    const title = "  Exact Title  ";
    const markdownContent = "# Heading\n\nBody text with **bold**.";

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);

    const supabase = makeSupabase({ data: makeRpcNote({ title, markdown_content: markdownContent }), error: null });

    await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title,
      markdownContent,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_note_and_create_version",
      expect.objectContaining({
        p_title: title,
        p_markdown_content: markdownContent,
      })
    );
  });

  it("passes null summary and empty tags when omitted", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ data: makeRpcNote(), error: null });

    await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title: "Title",
      markdownContent: "content",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_note_and_create_version",
      expect.objectContaining({
        p_summary: null,
        p_tags: [],
        p_read_hint: null,
      })
    );
  });

  it("forwards explicit summary, tags, and readHint verbatim", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ data: makeRpcNote(), error: null });

    await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title: "Title",
      markdownContent: "content",
      summary: "Short summary",
      tags: ["alpha", "beta"],
      readHint: "read_first",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_note_and_create_version",
      expect.objectContaining({
        p_summary: "Short summary",
        p_tags: ["alpha", "beta"],
        p_read_hint: "read_first",
      })
    );
  });
});

// ─── Diff computed from old state ─────────────────────────────────────────────

describe("updateNote — diff from prior state", () => {
  it("computes diff using the OLD title and content before the update", async () => {
    const oldNote = makeNote({
      title: "Old Title",
      markdown_content: "# Old",
      content_bytes: 5,
      summary: "old summary",
      tags: ["x"],
      status: "active",
    });

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(oldNote as never);
    const supabase = makeSupabase({ data: makeRpcNote(), error: null });

    await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title: "New Title",
      markdownContent: "# New content",
      summary: "new summary",
      tags: ["y"],
    });

    // computeDiffSummary must see old state as first arg
    expect(diffUtils.computeDiffSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Old Title",
        markdown_content: "# Old",
      }),
      expect.objectContaining({
        title: "New Title",
        markdown_content: "# New content",
      })
    );
  });

  it("throws 'Note not found' when the current note does not exist", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);
    const supabase = makeSupabase({ data: makeRpcNote(), error: null });

    // updateNote now guards on existence (defense-in-depth) before the RPC:
    // a missing note short-circuits with a thrown error rather than proceeding
    // with a null diff_summary.
    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("Note not found");

    expect(diffUtils.computeDiffSummary).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("forwards diff_summary returned by computeDiffSummary to RPC", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const customDiff: import("@/server/services/diff_utils").DiffSummary = {
      title_changed: true,
      body_changed: true,
      summary_changed: false,
      tags_changed: false,
      status_changed: false,
      bytes_added: 20,
      bytes_removed: 5,
    };
    vi.mocked(diffUtils.computeDiffSummary).mockReturnValue(customDiff);
    const supabase = makeSupabase({ data: makeRpcNote(), error: null });

    await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title: "New",
      markdownContent: "new body",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_note_and_create_version",
      expect.objectContaining({ p_diff_summary: customDiff })
    );
  });
});

// ─── RPC error propagation ────────────────────────────────────────────────────

describe("updateNote — error propagation", () => {
  it("throws when RPC returns an error", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({
      data: null,
      error: { message: "constraint violation" },
    });

    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("constraint violation");
  });

  it("throws generic message when RPC returns null data with no error message", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ data: null, error: null });

    await expect(
      updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
        title: "Title",
        markdownContent: "content",
      })
    ).rejects.toThrow("Failed to update note");
  });

  it("fires audit event after successful update", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    const supabase = makeSupabase({ data: makeRpcNote(), error: null });

    await updateNote(supabase, USER_ID, WORKSPACE_ID, NOTE_ID, {
      title: "Title",
      markdownContent: "content",
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
