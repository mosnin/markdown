import { describe, it, expect, vi } from "vitest";

/**
 * Branch-aware link_service (note_link) semantics.
 *
 * Invariants:
 *  - `createLink` with `branchId` stamps `branch_id` on the insert.
 *  - `deleteLink` on a main row from a branch records a pending
 *    detach op instead of hard-deleting.
 *  - `deleteLink` on a branch-local row (branch_id matches
 *    activeBranch) hard-deletes in place; no pending op.
 *  - `deleteLink` on a row owned by *another* branch is rejected.
 */

vi.mock("@/server/repositories/note_link_repository", () => ({
  getNoteLinkById: vi.fn(),
  listLinksFromNote: vi.fn(),
  listLinksToNote: vi.fn(),
  createNoteLink: vi.fn(async (_sb: unknown, input: Record<string, unknown>) => ({
    id: "nl-new",
    ...input,
    created_at: new Date().toISOString(),
  })),
  deleteNoteLink: vi.fn(async () => true),
}));

vi.mock("@/server/repositories/note_repository", () => ({
  getNoteById: vi.fn(async (_sb: unknown, id: string) => ({ id, box_id: "box-1" })),
}));

vi.mock("@/server/services/audit_service", () => ({
  auditNoteLinkCreated: vi.fn(),
  auditNoteLinkDeleted: vi.fn(),
}));

vi.mock("@/server/services/pending_op_service", () => ({
  recordPendingOp: vi.fn(),
}));

import * as noteLinkRepo from "@/server/repositories/note_link_repository";
import * as pendingOpService from "@/server/services/pending_op_service";
import {
  createLink as createNoteLinkService,
  deleteLink as deleteNoteLinkService,
} from "@/server/services/link_service";

describe("link_service.createLink", () => {
  it("stamps branch_id on create when branchId is supplied", async () => {
    vi.mocked(noteLinkRepo.createNoteLink).mockClear();
    await createNoteLinkService({} as never, "user-1", "w", {
      sourceNoteId: "n-1",
      targetNoteId: "n-2",
      relationshipType: "related",
      branchId: "br-1",
    });
    const mk = vi.mocked(noteLinkRepo.createNoteLink);
    const lastCall = mk.mock.calls[mk.mock.calls.length - 1];
    expect(lastCall?.[1].branch_id).toBe("br-1");
  });

  it("writes branch_id=null when no branchId is passed", async () => {
    vi.mocked(noteLinkRepo.createNoteLink).mockClear();
    await createNoteLinkService({} as never, "user-1", "w", {
      sourceNoteId: "n-1",
      targetNoteId: "n-2",
      relationshipType: "related",
    });
    const mk = vi.mocked(noteLinkRepo.createNoteLink);
    const lastCall = mk.mock.calls[mk.mock.calls.length - 1];
    expect(lastCall?.[1].branch_id).toBeNull();
  });
});

describe("link_service.deleteLink", () => {
  it("records a pending detach op on branch delete of main row", async () => {
    vi.mocked(pendingOpService.recordPendingOp).mockClear();
    vi.mocked(noteLinkRepo.deleteNoteLink).mockClear();
    vi.mocked(noteLinkRepo.getNoteLinkById).mockResolvedValueOnce({
      id: "nl-main",
      source_note_id: "n-1",
      target_note_id: "n-2",
      relationship_type: "related",
      relationship_note: null,
      branch_id: null,
      created_at: new Date().toISOString(),
    });
    await deleteNoteLinkService({} as never, "user-1", "w", "nl-main", {
      branchId: "br-1",
    });
    expect(vi.mocked(pendingOpService.recordPendingOp)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        branchId: "br-1",
        opType: "detach",
        objectType: "note_link",
        objectId: "nl-main",
      })
    );
    expect(vi.mocked(noteLinkRepo.deleteNoteLink)).not.toHaveBeenCalled();
  });

  it("hard-deletes a branch-local note_link in place", async () => {
    vi.mocked(pendingOpService.recordPendingOp).mockClear();
    vi.mocked(noteLinkRepo.deleteNoteLink).mockClear();
    vi.mocked(noteLinkRepo.getNoteLinkById).mockResolvedValueOnce({
      id: "nl-branch",
      source_note_id: "n-1",
      target_note_id: "n-2",
      relationship_type: "related",
      relationship_note: null,
      branch_id: "br-1",
      created_at: new Date().toISOString(),
    });
    await deleteNoteLinkService({} as never, "user-1", "w", "nl-branch", {
      branchId: "br-1",
    });
    expect(vi.mocked(noteLinkRepo.deleteNoteLink)).toHaveBeenCalledWith(
      expect.any(Object),
      "nl-branch"
    );
    expect(vi.mocked(pendingOpService.recordPendingOp)).not.toHaveBeenCalled();
  });

  it("refuses to mutate a link owned by another branch", async () => {
    vi.mocked(noteLinkRepo.getNoteLinkById).mockResolvedValueOnce({
      id: "nl-other",
      source_note_id: "n-1",
      target_note_id: "n-2",
      relationship_type: "related",
      relationship_note: null,
      branch_id: "br-2",
      created_at: new Date().toISOString(),
    });
    await expect(
      deleteNoteLinkService({} as never, "user-1", "w", "nl-other", {
        branchId: "br-1",
      })
    ).rejects.toThrow(/another branch/);
  });
});
