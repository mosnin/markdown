import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for lifecycle service guard logic.
 *
 * Tests the critical trust invariants:
 * - Guide note protection (cannot archive or trash the active guide note)
 * - Status transition guards (cannot archive already-archived, etc.)
 * - Ownership enforcement (wrong workspace_id → not found)
 *
 * Uses vi.mock() to stub repository dependencies so tests run without a DB.
 */

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/box_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/services/audit_service");

import { archiveNote, trashNote, unarchiveNote, restoreNote } from "@/server/services/lifecycle_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as boxRepo from "@/server/repositories/box_repository";
import * as auditService from "@/server/services/audit_service";

// Minimal stubs
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
} as unknown as Parameters<typeof archiveNote>[0];

const WORKSPACE_ID = "ws-001";
const BOX_ID = "box-001";
const NOTE_ID = "note-001";

function makeNote(overrides: Partial<{
  id: string;
  box_id: string;
  status: string;
  title: string;
}> = {}) {
  return {
    id: NOTE_ID,
    box_id: BOX_ID,
    status: "active",
    title: "Test Note",
    ...overrides,
  };
}

function makeBox(overrides: Partial<{ guide_note_id: string | null }> = {}) {
  return {
    id: BOX_ID,
    workspace_id: WORKSPACE_ID,
    guide_note_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: audit events are no-ops
  vi.mocked(auditService.auditNoteArchived).mockResolvedValue(undefined);
  vi.mocked(auditService.auditNoteTrashed).mockResolvedValue(undefined);
  vi.mocked(auditService.auditNoteUnarchived).mockResolvedValue(undefined);
  vi.mocked(auditService.auditNoteRestored).mockResolvedValue(undefined);
});

describe("archiveNote", () => {
  it("archives an active note with no guide assignment", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeNote({ status: "archived" }) as never
    );
    // No guide assignment
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({ data: null });

    const result = await archiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID);
    expect(result.status).toBe("archived");
  });

  it("throws if note is already archived", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeNote({ status: "archived" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      archiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("already archived");
  });

  it("throws if note is trashed", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeNote({ status: "trashed" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      archiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("Cannot archive a trashed note");
  });

  it("throws if note is the current guide note (guide note protection)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(
      makeBox({ guide_note_id: NOTE_ID }) as never
    );
    // Simulate guide assignment found
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({ data: { id: BOX_ID } });

    await expect(
      archiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("guide note");
  });

  it("throws if note is not found (ownership check)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);

    await expect(
      archiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("not found");
  });

  it("throws if note belongs to a different workspace", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(
      makeBox() as unknown as ReturnType<typeof makeBox> & { workspace_id: "other-ws" }
    );
    // getBoxById returns box with wrong workspace_id
    vi.mocked(boxRepo.getBoxById).mockResolvedValue({
      ...makeBox(),
      workspace_id: "other-ws",
    } as never);

    await expect(
      archiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("not found");
  });
});

describe("trashNote", () => {
  it("trashes an active note with no guide assignment", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeNote({ status: "trashed" }) as never
    );
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({ data: null });

    const result = await trashNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID);
    expect(result.status).toBe("trashed");
  });

  it("throws if note is already trashed", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeNote({ status: "trashed" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      trashNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("already trashed");
  });

  it("throws if note is the current guide note (guide note protection)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    // Simulate guide found in DB query
    mockSupabase.maybeSingle = vi.fn().mockResolvedValue({ data: { id: BOX_ID } });

    await expect(
      trashNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("guide note");
  });
});

describe("unarchiveNote", () => {
  it("unarchives an archived note", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeNote({ status: "archived" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeNote({ status: "active" }) as never
    );

    const result = await unarchiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID);
    expect(result.status).toBe("active");
  });

  it("throws if note is not archived", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      unarchiveNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("not archived");
  });
});

describe("restoreNote", () => {
  it("restores a trashed note", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeNote({ status: "trashed" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeNote({ status: "active" }) as never
    );

    const result = await restoreNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID);
    expect(result.status).toBe("active");
  });

  it("throws if note is not trashed", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      restoreNote(mockSupabase, "user-1", WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("not trashed");
  });
});
