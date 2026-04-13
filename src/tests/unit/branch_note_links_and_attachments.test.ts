import { describe, it, expect, vi } from "vitest";

/**
 * Branch-local coverage for `note_links` and `box_object_attachments`
 * — the last two tables where create on a draft branch was leaking
 * canonical state onto main.
 *
 * Invariants:
 *
 *   1. `listLinksFromNote` filters main vs. branch rows the same
 *      way the file/folder readers do.
 *   2. `listAttachmentsForBox` applies the branch filter at the
 *      query level (`branch_id IS NULL` OR `= branch`).
 *   3. `createLink` (object_link_service) passes `branchId` down
 *      to the repo insert as `branch_id` on the row.
 *
 * The link_service (note_link) branch-delete semantics live in
 * `branch_note_link_service.test.ts` to keep the vi.mock shape
 * scoped: mocking `note_link_repository` here would shadow the
 * direct repo reads exercised above.
 */

// ─── listLinksFromNote branch filter ─────────────────────────────────────────

import {
  listLinksFromNote,
  listLinksToNote,
} from "@/server/repositories/note_link_repository";

function makeLinkMockSupabase(rows: Array<Record<string, unknown>>) {
  const filters: Record<string, unknown> = {};
  let orFilter: string | null = null;
  const query = {
    select: () => query,
    eq: (col: string, v: unknown) => {
      filters[col] = v;
      return query;
    },
    is: (col: string, v: unknown) => {
      filters[`${col}:is`] = v;
      return query;
    },
    or: (expr: string) => {
      orFilter = expr;
      return query;
    },
    order: () => query,
    then: async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      const out = rows.filter((r) => {
        if (filters["branch_id:is"] === null) return r.branch_id === null;
        if (orFilter) {
          const m = orFilter.match(/branch_id\.eq\.([^,]+)/);
          const bid = m?.[1];
          return r.branch_id === null || r.branch_id === bid;
        }
        return true;
      });
      resolve({ data: out, error: null });
    },
  };
  return { from: () => query } as never;
}

describe("listLinksFromNote branch filter", () => {
  const main = { id: "l-main", branch_id: null, source_note_id: "n-1", target_note_id: "n-2" };
  const branch1 = { id: "l-b1", branch_id: "b1", source_note_id: "n-1", target_note_id: "n-3" };
  const branch2 = { id: "l-b2", branch_id: "b2", source_note_id: "n-1", target_note_id: "n-4" };

  it("returns only main rows without branchId", async () => {
    const sb = makeLinkMockSupabase([main, branch1, branch2]);
    const out = await listLinksFromNote(sb, "n-1");
    expect(out.map((l) => l.id)).toEqual(["l-main"]);
  });

  it("returns main + active-branch rows with branchId", async () => {
    const sb = makeLinkMockSupabase([main, branch1, branch2]);
    const out = await listLinksFromNote(sb, "n-1", { branchId: "b1" });
    expect(out.map((l) => l.id).sort()).toEqual(["l-b1", "l-main"]);
  });

  it("hides other branches' rows", async () => {
    const sb = makeLinkMockSupabase([main, branch1, branch2]);
    const out = await listLinksFromNote(sb, "n-1", { branchId: "b1" });
    expect(out.find((l) => l.id === "l-b2")).toBeUndefined();
  });

  it("applies the same filter to listLinksToNote", async () => {
    const sb = makeLinkMockSupabase([main, branch1, branch2]);
    const out = await listLinksToNote(sb, "n-2", { branchId: "b1" });
    expect(out.find((l) => l.id === "l-b2")).toBeUndefined();
  });
});

// ─── listAttachmentsForBox branch filter ─────────────────────────────────────

import { listAttachmentsForBox } from "@/server/repositories/box_object_attachment_repository";

describe("listAttachmentsForBox branch filter", () => {
  const main = {
    id: "a-main", branch_id: null, box_id: "b",
    object_type: "skill", object_id: "s-main", sort_order: 0,
  };
  const branch1 = {
    id: "a-b1", branch_id: "br-1", box_id: "b",
    object_type: "skill", object_id: "s-b1", sort_order: 1,
  };
  const branch2 = {
    id: "a-b2", branch_id: "br-2", box_id: "b",
    object_type: "agent", object_id: "a-b2", sort_order: 2,
  };

  it("returns only main attachments when no branchId is passed", async () => {
    const sb = makeLinkMockSupabase([main, branch1, branch2]);
    const out = await listAttachmentsForBox(sb, "b");
    expect(out.map((r) => r.id)).toEqual(["a-main"]);
  });

  it("returns main + branch attachments when branchId is active", async () => {
    const sb = makeLinkMockSupabase([main, branch1, branch2]);
    const out = await listAttachmentsForBox(sb, "b", { branchId: "br-1" });
    expect(out.map((r) => r.id).sort()).toEqual(["a-b1", "a-main"]);
  });

  it("still hides other branches' attachments", async () => {
    const sb = makeLinkMockSupabase([main, branch1, branch2]);
    const out = await listAttachmentsForBox(sb, "b", { branchId: "br-1" });
    expect(out.find((r) => r.id === "a-b2")).toBeUndefined();
  });
});

// ─── object_link_service.createLink threads branchId ─────────────────────────

vi.mock("@/server/repositories/object_link_repository", () => ({
  createObjectLink: vi.fn(async (_sb: unknown, input: Record<string, unknown>) => ({
    id: "new-id",
    ...input,
    created_at: new Date().toISOString(),
  })),
  deleteObjectLink: vi.fn(),
  getObjectLinksForSource: vi.fn(),
  getObjectLinksForTarget: vi.fn(),
}));

vi.mock("@/server/repositories/workspace_object_repository", () => ({
  getWorkspaceObject: vi.fn(async (_sb: unknown, _type: unknown, id: string) => ({
    id,
    workspace_id: "w",
    object_type: "agent",
  })),
}));

import * as objectLinkRepo from "@/server/repositories/object_link_repository";
import { createLink as createObjectLinkService } from "@/server/services/object_link_service";

// ─── createAttachment branch_id pass-through ─────────────────────────────────
//
// Thin test — asserts the repo forwards `branch_id` on the insert
// row. Defends against regressions where a caller threads branchId
// but the repo silently drops the column.

import { createAttachment } from "@/server/repositories/box_object_attachment_repository";

describe("createAttachment threads branch_id", () => {
  it("includes branch_id when supplied", async () => {
    let insertPayload: unknown = null;
    const sb = {
      from: () => ({
        insert: (payload: unknown) => {
          insertPayload = payload;
          return {
            select: () => ({
              single: async () => ({
                data: { id: "a-1", ...(payload as Record<string, unknown>) },
                error: null,
              }),
            }),
          };
        },
      }),
    } as never;
    await createAttachment(sb, {
      workspace_id: "w",
      box_id: "b",
      object_type: "skill",
      object_id: "s",
      branch_id: "br-1",
    });
    expect((insertPayload as Record<string, unknown>).branch_id).toBe("br-1");
  });

  it("omits branch_id cleanly when null", async () => {
    let insertPayload: unknown = null;
    const sb = {
      from: () => ({
        insert: (payload: unknown) => {
          insertPayload = payload;
          return {
            select: () => ({
              single: async () => ({
                data: { id: "a-1", ...(payload as Record<string, unknown>) },
                error: null,
              }),
            }),
          };
        },
      }),
    } as never;
    await createAttachment(sb, {
      workspace_id: "w",
      box_id: "b",
      object_type: "skill",
      object_id: "s",
      branch_id: null,
    });
    expect((insertPayload as Record<string, unknown>).branch_id).toBeNull();
  });
});

describe("object_link_service.createLink threading", () => {
  it("stamps branch_id on insert when branchId is supplied", async () => {
    await createObjectLinkService({} as never, "w", {
      sourceObjectType: "agent",
      sourceObjectId: "a-1",
      targetObjectType: "skill",
      targetObjectId: "s-1",
      relationshipType: "depends_on",
      branchId: "br-1",
    });
    const mk = vi.mocked(objectLinkRepo.createObjectLink);
    const lastCall = mk.mock.calls[mk.mock.calls.length - 1];
    expect(lastCall?.[1].branch_id).toBe("br-1");
  });

  it("defaults branch_id to null for main writes", async () => {
    await createObjectLinkService({} as never, "w", {
      sourceObjectType: "agent",
      sourceObjectId: "a-1",
      targetObjectType: "skill",
      targetObjectId: "s-1",
      relationshipType: "depends_on",
    });
    const mk = vi.mocked(objectLinkRepo.createObjectLink);
    const lastCall = mk.mock.calls[mk.mock.calls.length - 1];
    expect(lastCall?.[1].branch_id).toBeNull();
  });
});
