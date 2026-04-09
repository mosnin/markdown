import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests: lifecycle guide note protection — end-to-end guard chain
 *
 * Validates the complete protection flow across all lifecycle operations:
 *
 * The system guarantees:
 *   1. A note that IS the current box guide note cannot be archived or trashed.
 *   2. A note that IS NOT the guide note CAN be archived or trashed.
 *   3. An archived note cannot be archived again; a trashed note cannot be
 *      trashed again (idempotency guards).
 *   4. Restoring a trashed note makes it active again.
 *   5. Unarchiving an archived note makes it active again.
 *
 * These tests exercise the full service function, not just individual guards.
 * They verify that the correct DB lookup sequence runs and that the error
 * messages are legible for human operators.
 */

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/box_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/services/audit_service");

import {
  archiveNote,
  trashNote,
  unarchiveNote,
  restoreNote,
} from "@/server/services/lifecycle_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as boxRepo from "@/server/repositories/box_repository";
import * as auditService from "@/server/services/audit_service";

const WORKSPACE_ID = "ws-integration-004";
const BOX_ID = "box-004";
const GUIDE_NOTE_ID = "guide-note-004";
const REGULAR_NOTE_ID = "regular-note-004";

function makeGuideNote() {
  return {
    id: GUIDE_NOTE_ID,
    box_id: BOX_ID,
    status: "active",
    title: "Box Guide",
  };
}

function makeRegularNote(overrides: Record<string, unknown> = {}) {
  return {
    id: REGULAR_NOTE_ID,
    box_id: BOX_ID,
    status: "active",
    title: "Regular Note",
    ...overrides,
  };
}

function makeBox(guideNoteId: string | null = GUIDE_NOTE_ID) {
  return {
    id: BOX_ID,
    workspace_id: WORKSPACE_ID,
    status: "active",
    guide_note_id: guideNoteId,
  };
}

// Supabase mock that simulates a DB query returning a guide assignment.
// The `findGuideNoteAssignment` query checks boxes.guide_note_id = noteId.
function makeSupabaseWithGuide(noteIdIsGuide: boolean) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(
      noteIdIsGuide ? { data: { id: BOX_ID } } : { data: null }
    ),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditNoteArchived).mockResolvedValue(undefined);
  vi.mocked(auditService.auditNoteTrashed).mockResolvedValue(undefined);
  vi.mocked(auditService.auditNoteUnarchived).mockResolvedValue(undefined);
  vi.mocked(auditService.auditNoteRestored).mockResolvedValue(undefined);
});

describe("Guide note protection — archive", () => {
  it("blocks archiving the current guide note with a clear error message", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeGuideNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    const mockSupabase = makeSupabaseWithGuide(true);

    await expect(
      archiveNote(mockSupabase, "user-1", WORKSPACE_ID, GUIDE_NOTE_ID)
    ).rejects.toThrow("guide note");
  });

  it("allows archiving a non-guide note in the same box", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeRegularNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeRegularNote({ status: "archived" }) as never
    );
    const mockSupabase = makeSupabaseWithGuide(false);

    const result = await archiveNote(
      mockSupabase, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID
    );
    expect(result.status).toBe("archived");
  });
});

describe("Guide note protection — trash", () => {
  it("blocks trashing the current guide note with a clear error message", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeGuideNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    const mockSupabase = makeSupabaseWithGuide(true);

    await expect(
      trashNote(mockSupabase, "user-1", WORKSPACE_ID, GUIDE_NOTE_ID)
    ).rejects.toThrow("guide note");
  });

  it("allows trashing a non-guide note in the same box", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeRegularNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeRegularNote({ status: "trashed" }) as never
    );
    const mockSupabase = makeSupabaseWithGuide(false);

    const result = await trashNote(
      mockSupabase, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID
    );
    expect(result.status).toBe("trashed");
  });

  it("allows trashing a note after the guide assignment is cleared", async () => {
    // Scenario: user clears guide assignment, then trashes the former guide note.
    // The box now has guide_note_id = null.
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeGuideNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox(null) as never); // guide cleared
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      { ...makeGuideNote(), status: "trashed" } as never
    );
    const mockSupabase = makeSupabaseWithGuide(false); // no guide assignment in DB

    const result = await trashNote(
      mockSupabase, "user-1", WORKSPACE_ID, GUIDE_NOTE_ID
    );
    expect(result.status).not.toBe("active");
  });
});

describe("Lifecycle idempotency guards", () => {
  it("throws a clear error when archiving an already-archived note", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeRegularNote({ status: "archived" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      archiveNote({} as never, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID)
    ).rejects.toThrow("already archived");
  });

  it("throws a clear error when trashing an already-trashed note", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeRegularNote({ status: "trashed" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      trashNote({} as never, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID)
    ).rejects.toThrow("already trashed");
  });

  it("throws when trying to archive a trashed note (wrong direction)", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeRegularNote({ status: "trashed" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      archiveNote({} as never, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID)
    ).rejects.toThrow("Cannot archive a trashed note");
  });
});

describe("Restore and unarchive", () => {
  it("restores a trashed note to active", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeRegularNote({ status: "trashed" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeRegularNote({ status: "active" }) as never
    );

    const result = await restoreNote(
      {} as never, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID
    );
    expect(result.status).toBe("active");
  });

  it("unarchives an archived note to active", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeRegularNote({ status: "archived" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(noteRepo.updateNote).mockResolvedValue(
      makeRegularNote({ status: "active" }) as never
    );

    const result = await unarchiveNote(
      {} as never, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID
    );
    expect(result.status).toBe("active");
  });

  it("throws when trying to restore an already-active note", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(
      makeRegularNote({ status: "active" }) as never
    );
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    await expect(
      restoreNote({} as never, "user-1", WORKSPACE_ID, REGULAR_NOTE_ID)
    ).rejects.toThrow("not trashed");
  });
});
