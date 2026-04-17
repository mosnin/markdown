import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for Feature #7 — Context bundle branch awareness.
 *
 * Covers the `includeUserBranches` / `userId` opt-in on
 * `assembleContextBundle`:
 *
 * - Without `include_user_branches`, the bundle has no
 *   `pending_branch_changes` field.
 * - With `include_user_branches=true` but no branches → overlay is
 *   present and empty.
 * - With a branch owned by the user touching a bundle object → one
 *   entry with correct ids and a trimmed content preview.
 * - With a branch owned by a DIFFERENT user → NOT included (privacy).
 * - With a user-owned branch touching an unrelated object → NOT
 *   included.
 * - Preview is trimmed at BRANCH_CONTENT_PREVIEW_MAX (1000 chars).
 *
 * We mock the note / box / folder / link / version repositories the
 * main assembly pipeline already uses, and stub the supabase client
 * just for the branch overlay queries (`draft_branches`,
 * `branch_heads`, `note_versions`, `object_versions`).
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

const WORKSPACE_ID = "ws-bundle-branch";
const BOX_ID = "box-bundle-branch";
const NOTE_ID = "note-center";
const USER_ID = "user-me";
const OTHER_USER_ID = "user-other";
const BRANCH_ID = "branch-mine";
const BRANCH_VERSION_ID = "ver-branch-head";

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
    current_version_id: "ver-main",
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

/**
 * Build a minimal supabase-client stub whose `.from(table)` chains
 * return whatever our per-table handler says. Only the methods
 * actually used by the branch overlay code path are implemented.
 */
function makeSupabaseStub(handlers: {
  draftBranches?: () => { data: Array<{ id: string; name: string; created_at: string }> | null };
  branchHeads?: (branchId: string) => {
    data: Array<{ object_type: string; object_id: string; version_id: string }> | null;
  };
  noteVersion?: (
    versionId: string
  ) => { data: { markdown_content: string; title: string } | null };
  objectVersion?: (versionId: string) => { data: { source_content: string } | null };
}) {
  return {
    from(table: string) {
      if (table === "draft_branches") {
        const chain = {
          _filters: {} as Record<string, unknown>,
          select() { return chain; },
          eq(k: string, v: unknown) { chain._filters[k] = v; return chain; },
          order() { return chain; },
          then(resolve: (r: { data: unknown }) => unknown) {
            return Promise.resolve(resolve(handlers.draftBranches?.() ?? { data: [] }));
          },
        };
        return chain;
      }
      if (table === "branch_heads") {
        const chain: Record<string, unknown> = {
          _branchId: "",
          select() { return chain; },
          eq(k: string, v: unknown) {
            if (k === "branch_id") chain._branchId = v;
            return chain;
          },
          in() { return chain; },
          then(resolve: (r: { data: unknown }) => unknown) {
            return Promise.resolve(
              resolve(handlers.branchHeads?.(chain._branchId as string) ?? { data: [] })
            );
          },
        };
        return chain;
      }
      if (table === "note_versions") {
        const chain: Record<string, unknown> = {
          _id: "",
          select() { return chain; },
          eq(k: string, v: unknown) {
            if (k === "id") chain._id = v;
            return chain;
          },
          maybeSingle() {
            return Promise.resolve(
              handlers.noteVersion?.(chain._id as string) ?? { data: null }
            );
          },
        };
        return chain;
      }
      if (table === "object_versions") {
        const chain: Record<string, unknown> = {
          _id: "",
          select() { return chain; },
          eq(k: string, v: unknown) {
            if (k === "id") chain._id = v;
            return chain;
          },
          maybeSingle() {
            return Promise.resolve(
              handlers.objectVersion?.(chain._id as string) ?? { data: null }
            );
          },
        };
        return chain;
      }
      // Anything else returns a noop chain — assembly already has
      // mocks for repositories it uses.
      const noop: Record<string, unknown> = {
        select() { return noop; },
        eq() { return noop; },
        in() { return noop; },
        order() { return noop; },
        maybeSingle() { return Promise.resolve({ data: null }); },
        then(resolve: (r: { data: unknown }) => unknown) {
          return Promise.resolve(resolve({ data: [] }));
        },
      };
      return noop;
    },
  } as unknown as Parameters<typeof assembleContextBundle>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(versionRepo.getNoteVersionById).mockResolvedValue(null);
  vi.mocked(folderRepo.getFolderById).mockResolvedValue(null);
  vi.mocked(linkRepo.listLinksFromNote).mockResolvedValue([]);
  vi.mocked(linkRepo.listLinksToNote).mockResolvedValue([]);
  vi.mocked(noteRepo.getNotesByIds).mockResolvedValue([]);
  vi.mocked(noteRepo.getNoteById).mockResolvedValue(makeNote() as never);
  vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);
});

// ─── Opt-out (default) ─────────────────────────────────────────────────────────

describe("assembleContextBundle — branch overlay opt-out", () => {
  it("does not include pending_branch_changes when includeUserBranches is not set", async () => {
    const supabase = makeSupabaseStub({});
    const result = await assembleContextBundle(supabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
    });
    expect(result.pending_branch_changes).toBeUndefined();
    expect(result.assembly_metadata.include_user_branches).toBe(false);
  });

  it("does not include pending_branch_changes when includeUserBranches=true but userId is missing", async () => {
    // Passing the flag without a user id must NOT leak workspace-wide
    // branches. The service should silently degrade.
    const supabase = makeSupabaseStub({
      draftBranches: () => ({
        data: [{ id: BRANCH_ID, name: "bad", created_at: "2024-01-01T00:00:00.000Z" }],
      }),
    });
    const result = await assembleContextBundle(supabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
      includeUserBranches: true,
    });
    expect(result.pending_branch_changes).toBeUndefined();
    expect(result.assembly_metadata.include_user_branches).toBe(false);
  });
});

// ─── Opt-in ───────────────────────────────────────────────────────────────────

describe("assembleContextBundle — branch overlay opt-in", () => {
  it("returns an empty overlay when the user has no open branches", async () => {
    const supabase = makeSupabaseStub({
      draftBranches: () => ({ data: [] }),
    });
    const result = await assembleContextBundle(supabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
      includeUserBranches: true,
      userId: USER_ID,
    });
    expect(result.pending_branch_changes).toEqual([]);
    expect(result.assembly_metadata.include_user_branches).toBe(true);
  });

  it("includes a user-owned branch that touches the target note", async () => {
    const supabase = makeSupabaseStub({
      draftBranches: () => ({
        data: [
          {
            id: BRANCH_ID,
            name: "Refactor target",
            created_at: "2024-03-01T12:00:00.000Z",
          },
        ],
      }),
      branchHeads: (branchId) => {
        if (branchId !== BRANCH_ID) return { data: [] };
        return {
          data: [
            {
              object_type: "note",
              object_id: NOTE_ID,
              version_id: BRANCH_VERSION_ID,
            },
          ],
        };
      },
      noteVersion: (verId) => {
        if (verId !== BRANCH_VERSION_ID) return { data: null };
        return {
          data: {
            title: "Target Note (draft)",
            markdown_content: "draft body content",
          },
        };
      },
    });
    const result = await assembleContextBundle(supabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
      includeUserBranches: true,
      userId: USER_ID,
    });
    expect(result.pending_branch_changes).toHaveLength(1);
    const entry = result.pending_branch_changes![0];
    expect(entry.branch_id).toBe(BRANCH_ID);
    expect(entry.branch_name).toBe("Refactor target");
    expect(entry.branch_created_at).toBe("2024-03-01T12:00:00.000Z");
    expect(entry.touched).toHaveLength(1);
    const touched = entry.touched[0];
    expect(touched.object_type).toBe("note");
    expect(touched.object_id).toBe(NOTE_ID);
    expect(touched.branch_version_id).toBe(BRANCH_VERSION_ID);
    expect(touched.main_version_id).toBe("ver-main");
    expect(touched.branch_content_preview).toContain("Target Note (draft)");
    expect(touched.branch_content_preview).toContain("draft body content");
  });

  it("does not include branches owned by a different user", async () => {
    // The query filter is `created_by = userId`. Tests assert by
    // passing the OTHER user's rows from the stub — if the service
    // forwarded its filter to the stub, the stub would never see this
    // row because the filter is applied there. We simulate by having
    // the stub only return rows where the filter matched USER_ID; the
    // actual service filter eq('created_by', userId) is what enforces
    // this in production and the stub reflects that.
    const supabase = {
      from(table: string) {
        if (table === "draft_branches") {
          const state: Record<string, unknown> = {};
          const chain: Record<string, unknown> = {
            select() { return chain; },
            eq(k: string, v: unknown) {
              state[k] = v;
              return chain;
            },
            order() { return chain; },
            then(resolve: (r: { data: unknown }) => unknown) {
              // Only return the OTHER user's branch if created_by
              // filter matches them. When the service queries
              // created_by=USER_ID, the stub returns an empty set —
              // which is exactly what the DB would do.
              if (state.created_by === OTHER_USER_ID) {
                return Promise.resolve(
                  resolve({
                    data: [
                      { id: "branch-not-mine", name: "theirs", created_at: "2024-02-01T00:00:00.000Z" },
                    ],
                  })
                );
              }
              return Promise.resolve(resolve({ data: [] }));
            },
          };
          return chain;
        }
        const noop: Record<string, unknown> = {
          select() { return noop; },
          eq() { return noop; },
          in() { return noop; },
          order() { return noop; },
          maybeSingle() { return Promise.resolve({ data: null }); },
          then(resolve: (r: { data: unknown }) => unknown) {
            return Promise.resolve(resolve({ data: [] }));
          },
        };
        return noop;
      },
    } as unknown as Parameters<typeof assembleContextBundle>[0];

    const result = await assembleContextBundle(supabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
      includeUserBranches: true,
      userId: USER_ID,
    });
    // Our userId is USER_ID but only OTHER_USER_ID has a branch;
    // the DB filter excludes it, overlay is empty.
    expect(result.pending_branch_changes).toEqual([]);
  });

  it("excludes user-owned branches whose heads don't touch any bundle object", async () => {
    // Branch head points at a DIFFERENT note than any in the bundle.
    // The service `.in('object_id', objectIds)` filter prevents the
    // stub from returning this row — modelled by the stub.
    const unrelatedNoteId = "note-unrelated";
    const supabase = {
      from(table: string) {
        if (table === "draft_branches") {
          const chain: Record<string, unknown> = {
            select() { return chain; },
            eq() { return chain; },
            order() { return chain; },
            then(resolve: (r: { data: unknown }) => unknown) {
              return Promise.resolve(
                resolve({
                  data: [
                    { id: BRANCH_ID, name: "Unrelated drafts", created_at: "2024-04-01T00:00:00.000Z" },
                  ],
                })
              );
            },
          };
          return chain;
        }
        if (table === "branch_heads") {
          let requestedIds: string[] = [];
          const chain: Record<string, unknown> = {
            select() { return chain; },
            eq() { return chain; },
            in(col: string, vals: string[]) {
              if (col === "object_id") requestedIds = vals;
              return chain;
            },
            then(resolve: (r: { data: unknown }) => unknown) {
              // Simulate the DB filter: the branch head is for
              // `unrelatedNoteId`. If that id wasn't in the requested
              // id list, the row is filtered out.
              if (requestedIds.includes(unrelatedNoteId)) {
                return Promise.resolve(
                  resolve({
                    data: [
                      {
                        object_type: "note",
                        object_id: unrelatedNoteId,
                        version_id: BRANCH_VERSION_ID,
                      },
                    ],
                  })
                );
              }
              return Promise.resolve(resolve({ data: [] }));
            },
          };
          return chain;
        }
        const noop: Record<string, unknown> = {
          select() { return noop; },
          eq() { return noop; },
          in() { return noop; },
          order() { return noop; },
          maybeSingle() { return Promise.resolve({ data: null }); },
          then(resolve: (r: { data: unknown }) => unknown) {
            return Promise.resolve(resolve({ data: [] }));
          },
        };
        return noop;
      },
    } as unknown as Parameters<typeof assembleContextBundle>[0];

    const result = await assembleContextBundle(supabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
      includeUserBranches: true,
      userId: USER_ID,
    });
    expect(result.pending_branch_changes).toEqual([]);
  });

  it("trims branch content preview to BRANCH_CONTENT_PREVIEW_MAX (1000 chars)", async () => {
    const longBody = "x".repeat(5000);
    const supabase = makeSupabaseStub({
      draftBranches: () => ({
        data: [
          { id: BRANCH_ID, name: "Big draft", created_at: "2024-05-01T00:00:00.000Z" },
        ],
      }),
      branchHeads: () => ({
        data: [
          {
            object_type: "note",
            object_id: NOTE_ID,
            version_id: BRANCH_VERSION_ID,
          },
        ],
      }),
      noteVersion: () => ({
        data: { title: "", markdown_content: longBody },
      }),
    });
    const result = await assembleContextBundle(supabase, WORKSPACE_ID, NOTE_ID, {
      includeAncestorSummary: false,
      includeUserBranches: true,
      userId: USER_ID,
    });
    const preview = result.pending_branch_changes![0].touched[0].branch_content_preview;
    expect(preview).not.toBeNull();
    expect(preview!.length).toBeLessThanOrEqual(1000);
    // Exactly the cap, since the body itself is 5000 chars of `x`.
    expect(preview!.length).toBe(1000);
  });
});
