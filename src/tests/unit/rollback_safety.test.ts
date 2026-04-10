import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for rollback safety in version_history_service.ts
 *
 * Covers:
 * - Ownership enforcement: note must belong to the caller's workspace
 * - Version identity: rollback targets must belong to the note
 * - Immutability: rollback creates a NEW version, does not mutate history
 * - Not-found handling: missing note and missing version
 */

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/note_version_repository");
vi.mock("@/server/services/audit_service");
vi.mock("@/server/services/diff_utils");

import {
  listVersionsForNote,
  getVersionForNote,
  rollbackNoteToVersion,
} from "@/server/services/version_history_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as versionRepo from "@/server/repositories/note_version_repository";
import * as auditService from "@/server/services/audit_service";
import * as diffUtils from "@/server/services/diff_utils";

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
} as unknown as Parameters<typeof listVersionsForNote>[0];

const WORKSPACE_ID = "ws-001";
const OTHER_WORKSPACE_ID = "ws-999";
const BOX_ID = "box-001";
const NOTE_ID = "note-001";
const VERSION_ID = "version-001";
const TARGET_VERSION_ID = "version-002";
const USER_ID = "user-001";

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    box_id: BOX_ID,
    title: "Test Note",
    markdown_content: "# Hello",
    summary: null,
    tags: [],
    read_hint: null,
    kind: "note",
    status: "active",
    current_version_id: VERSION_ID,
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    note_id: NOTE_ID,
    version_number: 1,
    title: "Test Note",
    markdown_content: "# Hello",
    change_origin: "user_edit",
    actor_type: "user",
    actor_id: USER_ID,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function setupBoxOwnership(workspaceId: string) {
  // Mock the supabase chain used in resolveNoteWithOwnership
  mockSupabase.from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { workspace_id: workspaceId },
          error: null,
        }),
      }),
    }),
  });
}

const MOCK_ROLLBACK_DIFF: import("@/server/services/diff_utils").DiffSummary = {
  title_changed: false,
  body_changed: true,
  summary_changed: false,
  tags_changed: false,
  status_changed: false,
  bytes_added: 10,
  bytes_removed: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditNoteRollback).mockResolvedValue(undefined as never);
  vi.mocked(diffUtils.computeRollbackDiff).mockReturnValue(MOCK_ROLLBACK_DIFF);
});

// ─── listVersionsForNote ──────────────────────────────────────────────────────

describe("listVersionsForNote — ownership", () => {
  it("throws if note belongs to a different workspace", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    setupBoxOwnership(OTHER_WORKSPACE_ID);

    await expect(
      listVersionsForNote(mockSupabase, WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("not found");
  });

  it("throws if note does not exist", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);

    await expect(
      listVersionsForNote(mockSupabase, WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("not found");
  });

  it("returns version list with is_current flags for owned note", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    setupBoxOwnership(WORKSPACE_ID);

    const v1 = makeVersion();
    const v2 = makeVersion({ id: "version-002", version_number: 2, change_origin: "rollback" });
    vi.mocked(versionRepo.listVersionsByNote).mockResolvedValue([v2, v1] as never);

    const result = await listVersionsForNote(mockSupabase, WORKSPACE_ID, NOTE_ID);

    expect(result.note_id).toBe(NOTE_ID);
    expect(result.current_version_id).toBe(VERSION_ID);
    expect(result.versions).toHaveLength(2);
    // is_current reflects the note's current_version_id
    const current = result.versions.find((v) => v.id === VERSION_ID);
    expect(current?.is_current).toBe(true);
    const other = result.versions.find((v) => v.id === "version-002");
    expect(other?.is_current).toBe(false);
  });
});

// ─── getVersionForNote ────────────────────────────────────────────────────────

describe("getVersionForNote — version identity", () => {
  it("throws if version does not exist on this note", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    setupBoxOwnership(WORKSPACE_ID);
    vi.mocked(versionRepo.getVersionByNoteAndId).mockResolvedValue(null);

    await expect(
      getVersionForNote(mockSupabase, WORKSPACE_ID, NOTE_ID, "nonexistent-version")
    ).rejects.toThrow("Version not found");
  });

  it("returns version with is_current flag when found", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    setupBoxOwnership(WORKSPACE_ID);
    vi.mocked(versionRepo.getVersionByNoteAndId).mockResolvedValue(makeVersion() as never);

    const result = await getVersionForNote(mockSupabase, WORKSPACE_ID, NOTE_ID, VERSION_ID);

    expect(result.version.id).toBe(VERSION_ID);
    expect(result.is_current).toBe(true);
    expect(result.note_id).toBe(NOTE_ID);
  });
});

// ─── rollbackNoteToVersion — immutability and ownership ──────────────────────

describe("rollbackNoteToVersion — ownership enforcement", () => {
  it("throws if note belongs to a different workspace", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    setupBoxOwnership(OTHER_WORKSPACE_ID);

    await expect(
      rollbackNoteToVersion(mockSupabase, USER_ID, WORKSPACE_ID, NOTE_ID, TARGET_VERSION_ID)
    ).rejects.toThrow("not found");
  });

  it("throws if note does not exist", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);

    await expect(
      rollbackNoteToVersion(mockSupabase, USER_ID, WORKSPACE_ID, NOTE_ID, TARGET_VERSION_ID)
    ).rejects.toThrow("not found");
  });
});

describe("rollbackNoteToVersion — immutability invariants", () => {
  it("creates a new version (does not mutate history) on successful rollback", async () => {
    const targetVersion = makeVersion({
      id: TARGET_VERSION_ID,
      version_number: 1,
      title: "Old Title",
      markdown_content: "# Old content",
    });

    const rollbackVersion = makeVersion({
      id: "version-003",
      version_number: 3,
      change_origin: "rollback",
      title: "Old Title",
      markdown_content: "# Old content",
    });

    const updatedNote = makeNote({
      title: "Old Title",
      markdown_content: "# Old content",
      current_version_id: "version-003",
    });

    vi.mocked(noteRepo.getNoteById)
      .mockResolvedValueOnce(makeNote() as never)  // ownership check
      .mockResolvedValueOnce(updatedNote as never); // post-RPC fetch

    setupBoxOwnership(WORKSPACE_ID);

    vi.mocked(versionRepo.getVersionByNoteAndId).mockResolvedValue(targetVersion as never);

    // Mock the RPC call (supabase.rpc)
    mockSupabase.rpc = vi.fn().mockResolvedValue({
      data: { new_version_id: "version-003", version_number: 3 },
      error: null,
    });

    const result = await rollbackNoteToVersion(
      mockSupabase,
      USER_ID,
      WORKSPACE_ID,
      NOTE_ID,
      TARGET_VERSION_ID
    );

    // New version was created with a different ID
    expect(result.new_version_id).toBe("version-003");
    expect(result.restored_from_version_id).toBe(TARGET_VERSION_ID);
    // The target version was read (not written) — immutability preserved
    expect(versionRepo.getVersionByNoteAndId).toHaveBeenCalledWith(
      mockSupabase,
      NOTE_ID,
      TARGET_VERSION_ID
    );
    // Audit event was fired
    expect(auditService.auditNoteRollback).toHaveBeenCalled();
  });
});
