import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for context bundle assembly in context_bundle_service.ts.
 *
 * Covers:
 * - Ownership: missing note → "Note not found"; wrong workspace → "Not found"
 * - Exclusion: trashed linked notes excluded; archived excluded unless opted in
 * - Guide deduplication: guide note never appears in linked_notes
 * - Target deduplication: target note never appears in linked_notes
 * - Linked limit: capped at 10; truncation_reason populated when limited
 * - Relationship ranking: depends_on before related before sibling_of
 * - Guide excluded when same as target note
 * - Ancestor summary: skipped for root-level notes (truncation_reason added)
 */

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/box_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/repositories/note_version_repository");
vi.mock("@/server/repositories/note_link_repository");

import { assembleContextBundle } from "@/server/services/context_bundle_service";
import * as noteRepo from "@/server/repositories/note_repository";
import * as boxRepo from "@/server/repositories/box_repository";
import * as folderRepo from "@/server/repositories/folder_repository";
import * as versionRepo from "@/server/repositories/note_version_repository";
import * as linkRepo from "@/server/repositories/note_link_repository";

const WORKSPACE_ID = "ws-001";
const OTHER_WORKSPACE_ID = "ws-999";
const BOX_ID = "box-001";
const NOTE_ID = "note-001";
const GUIDE_NOTE_ID = "guide-note-001";

const mockSupabase = {} as Parameters<typeof assembleContextBundle>[0];

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    box_id: BOX_ID,
    folder_id: null,
    title: "Target Note",
    kind: "note",
    status: "active",
    markdown_content: "# Target",
    summary: null,
    tags: [],
    read_hint: null,
    retrieval_priority: 0,
    path_cache: "target-note",
    current_version_id: "version-001",
    updated_at: "2024-01-01T00:00:00.000Z",
    content_bytes: 9,
    ...overrides,
  };
}

function makeBox(overrides: Record<string, unknown> = {}) {
  return {
    id: BOX_ID,
    workspace_id: WORKSPACE_ID,
    name: "Test Box",
    slug: "test-box",
    guide_note_id: null,
    ...overrides,
  };
}

function makeLinkedNote(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    box_id: BOX_ID,
    folder_id: null,
    title: `Note ${id}`,
    kind: "note",
    status: "active",
    markdown_content: "content",
    summary: null,
    tags: [],
    read_hint: null,
    retrieval_priority: 0,
    path_cache: id,
    current_version_id: null,
    updated_at: "2024-01-01T00:00:00.000Z",
    content_bytes: 7,
    ...overrides,
  };
}

function makeLink(id: string, sourceId: string, targetId: string, type = "related") {
  return {
    id,
    source_note_id: sourceId,
    target_note_id: targetId,
    relationship_type: type as import("@/server/domain/constants/note_constants").RelationshipType,
    relationship_note: null,
    created_at: "2024-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(versionRepo.getNoteVersionById).mockResolvedValue(null);
  vi.mocked(folderRepo.getFolderById).mockResolvedValue(null);
  vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([]);
  vi.mocked(linkRepo.listLinksToNote).mockResolvedValue([]);
  vi.mocked(noteRepo.getNotesByIds).mockResolvedValue([]);
});

// ─── Ownership / not-found ─────────────────────────────────────────────────────

describe("assembleContextBundle — ownership", () => {
  it("throws 'Note not found' when note does not exist", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(null);

    await expect(
      assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("Note not found");
  });

  it("throws 'Not found' when box belongs to a different workspace", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(
      makeBox({ workspace_id: OTHER_WORKSPACE_ID }) as never
    );

    await expect(
      assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("Not found");
  });

  it("throws 'Not found' when box does not exist", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(null);

    await expect(
      assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID)
    ).rejects.toThrow("Not found");
  });
});

// ─── Target note exclusion ────────────────────────────────────────────────────

describe("assembleContextBundle — target self-exclusion", () => {
  it("never includes the target note in linked_notes", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    // Outgoing link from target to itself (shouldn't happen in DB, but guard it)
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([
      makeLink("link-1", NOTE_ID, NOTE_ID, "related"),
    ]);
    // NOTE_ID is in alwaysExclude, so getNotesByIds receives [] and must return []
    vi.mocked(noteRepo.getNotesByIds).mockImplementation(async (_sb, ids) => {
      return ids.includes(NOTE_ID) ? [makeNote() as never] : [];
    });

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID);

    expect(result.linked_notes.map((n) => n.id)).not.toContain(NOTE_ID);
  });
});

// ─── Trashed / archived exclusion ────────────────────────────────────────────

describe("assembleContextBundle — status filtering", () => {
  it("excludes trashed linked notes", async () => {
    const trashedNote = makeLinkedNote("note-trashed", { status: "trashed" });

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([
      makeLink("link-1", NOTE_ID, "note-trashed"),
    ]);
    vi.mocked(noteRepo.getNotesByIds).mockResolvedValue([trashedNote as never]);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID);

    expect(result.linked_notes).toHaveLength(0);
  });

  it("excludes archived linked notes by default", async () => {
    const archivedNote = makeLinkedNote("note-archived", { status: "archived" });

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([
      makeLink("link-1", NOTE_ID, "note-archived"),
    ]);
    vi.mocked(noteRepo.getNotesByIds).mockResolvedValue([archivedNote as never]);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID);

    expect(result.linked_notes).toHaveLength(0);
    expect(result.truncation_reasons).toContain("archived_excluded");
  });

  it("includes archived linked notes when includeArchived = true", async () => {
    const archivedNote = makeLinkedNote("note-archived", { status: "archived" });

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([
      makeLink("link-1", NOTE_ID, "note-archived"),
    ]);
    vi.mocked(noteRepo.getNotesByIds).mockResolvedValue([archivedNote as never]);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeArchived: true,
    });

    expect(result.linked_notes.map((n) => n.id)).toContain("note-archived");
  });
});

// ─── Guide note deduplication ─────────────────────────────────────────────────

describe("assembleContextBundle — guide deduplication", () => {
  it("does not include guide note in linked_notes", async () => {
    const guideNote = makeLinkedNote(GUIDE_NOTE_ID, { kind: "guide" });
    const box = makeBox({ guide_note_id: GUIDE_NOTE_ID });

    vi.mocked(noteRepo.getNoteById)
      .mockResolvedValueOnce(makeNote() as never)  // target note
      .mockResolvedValueOnce(guideNote as never);  // guide note lookup
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(box as never);

    // Guide note is also a linked note — service should exclude it from candidateIds
    // since it's in the alwaysExclude set after being resolved as guide note.
    // The getNotesByIds mock must only return notes whose IDs are actually requested.
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([
      makeLink("link-1", NOTE_ID, GUIDE_NOTE_ID, "related"),
    ]);
    vi.mocked(noteRepo.getNotesByIds).mockImplementation(async (_sb, ids) => {
      return ids.includes(GUIDE_NOTE_ID) ? [guideNote as never] : [];
    });

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });

    expect(result.guide_note?.id).toBe(GUIDE_NOTE_ID);
    expect(result.linked_notes.map((n) => n.id)).not.toContain(GUIDE_NOTE_ID);
  });

  it("excludes guide note when it is the same note as the target", async () => {
    const box = makeBox({ guide_note_id: NOTE_ID });

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(box as never);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });

    expect(result.guide_note).toBeNull();
  });
});

// ─── Linked limit ─────────────────────────────────────────────────────────────

describe("assembleContextBundle — linked limit", () => {
  it("caps linked_notes at 10 and adds truncation_reason when more available", async () => {
    // Create 12 candidate linked notes
    const candidates = Array.from({ length: 12 }, (_, i) =>
      makeLinkedNote(`note-${i}`)
    );
    const links = candidates.map((n, i) =>
      makeLink(`link-${i}`, NOTE_ID, n.id, "related")
    );

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue(links);
    vi.mocked(noteRepo.getNotesByIds).mockResolvedValue(candidates as never);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });

    expect(result.linked_notes).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(result.truncation_reasons).toContain("linked_limit_reached");
  });

  it("does not add truncation reason when all candidates fit within the limit", async () => {
    const candidates = Array.from({ length: 3 }, (_, i) =>
      makeLinkedNote(`note-${i}`)
    );
    const links = candidates.map((n, i) =>
      makeLink(`link-${i}`, NOTE_ID, n.id, "related")
    );

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue(links);
    vi.mocked(noteRepo.getNotesByIds).mockResolvedValue(candidates as never);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });

    expect(result.linked_notes).toHaveLength(3);
    expect(result.truncation_reasons).not.toContain("linked_limit_reached");
  });
});

// ─── Relationship ranking ──────────────────────────────────────────────────────

describe("assembleContextBundle — relationship ranking", () => {
  it("orders linked notes by importance: depends_on before related before sibling_of", async () => {
    const noteA = makeLinkedNote("note-a");
    const noteB = makeLinkedNote("note-b");
    const noteC = makeLinkedNote("note-c");

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([
      makeLink("link-c", NOTE_ID, "note-c", "sibling_of"),  // score 9
      makeLink("link-a", NOTE_ID, "note-a", "depends_on"),  // score 1
      makeLink("link-b", NOTE_ID, "note-b", "related"),     // score 8
    ]);
    vi.mocked(noteRepo.getNotesByIds).mockResolvedValue([noteA, noteB, noteC] as never);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });

    const ids = result.linked_notes.map((n) => n.id);
    expect(ids[0]).toBe("note-a");  // depends_on first
    expect(ids[1]).toBe("note-b");  // related second
    expect(ids[2]).toBe("note-c");  // sibling_of last
  });
});

// ─── Ancestor summary ─────────────────────────────────────────────────────────

describe("assembleContextBundle — ancestor summary", () => {
  it("adds ancestor_summary_not_found reason for root-level notes", async () => {
    // folder_id is null → root-level note
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote({ folder_id: null }) as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: true,
    });

    expect(result.ancestor_summary_note).toBeNull();
    expect(result.truncation_reasons).toContain("ancestor_summary_not_found");
  });

  it("does not add ancestor_summary_not_found when includeAncestorSummary = false", async () => {
    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote({ folder_id: null }) as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });

    expect(result.truncation_reasons).not.toContain("ancestor_summary_not_found");
  });
});

// ─── Cross-box exclusion ─────────────────────────────────────────────────────

describe("assembleContextBundle — cross-box exclusion", () => {
  it("excludes linked notes from a different box", async () => {
    const crossBoxNote = makeLinkedNote("note-other-box", { box_id: "box-other" });

    vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
    vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([
      makeLink("link-1", NOTE_ID, "note-other-box", "related"),
    ]);
    vi.mocked(noteRepo.getNotesByIds).mockResolvedValue([crossBoxNote as never]);

    const result = await assembleContextBundle(mockSupabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });

    expect(result.linked_notes).toHaveLength(0);
  });
});
