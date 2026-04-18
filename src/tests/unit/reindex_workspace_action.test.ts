import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the reindex-workspace admin server action.
 *
 * Covers:
 *   - Happy path: small workspace runs inline, reports indexed/failed counts.
 *   - Gate: non-admin callers are rejected with a friendly error.
 *   - Failure tallying: when upsertNoteEmbedding throws for a given note,
 *     the action keeps going and surfaces the failure in the count.
 *
 * Supabase is stubbed so no real DB is hit. The embedding service
 * `upsertNoteEmbedding` export is mocked per-case.
 */

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ delete: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/require_role", () => ({
  requireAdminRoleResult: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/embedding_service", () => ({
  upsertNoteEmbedding: vi.fn(),
}));

import { reindexWorkspaceAction } from "@/app/app/settings/workspace/semantic_search/actions";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { upsertNoteEmbedding } from "@/server/services/embedding_service";

const WS = "ws-1";
const UID = "user-1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Supabase-like mock that supports the exact chain the
 * reindex action uses:
 *   1. count via `.from("notes").select("id", {count,head}).eq().neq().is()`
 *   2. rows  via `.from("notes").select(cols).eq().neq().is().order().limit()`
 */
function makeMock(notes: Array<{ id: string; title: string; markdown_content: string | null }>) {
  const countChain = {
    eq: () => countChain,
    neq: () => countChain,
    is: () => Promise.resolve({ count: notes.length, data: null, error: null }),
  } as Record<string, unknown>;

  // Make is() also chain-capable before resolving
  (countChain as { is: (col: string, val: unknown) => unknown }).is = () =>
    Promise.resolve({ count: notes.length, data: null, error: null });

  const rowsChain: Record<string, unknown> = {
    eq: () => rowsChain,
    neq: () => rowsChain,
    is: () => rowsChain,
    order: () => rowsChain,
    limit: () => Promise.resolve({ data: notes, error: null }),
  };

  const from = vi.fn((table: string) => {
    if (table !== "notes") {
      return {
        select: () => ({
          eq: () => ({}),
        }),
      };
    }
    return {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) {
          return {
            eq: () => ({
              neq: () => ({
                is: () =>
                  Promise.resolve({
                    count: notes.length,
                    data: null,
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {
          eq: () => ({
            neq: () => ({
              is: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({ data: notes, error: null }),
                }),
              }),
            }),
          }),
        };
      },
    };
  });

  return { from };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reindexWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: reindexes every eligible note and returns counts", async () => {
    const notes = [
      { id: "n1", title: "One", markdown_content: "A" },
      { id: "n2", title: "Two", markdown_content: "B" },
      { id: "n3", title: "Three", markdown_content: "C" },
    ];
    const client = makeMock(notes);

    vi.mocked(requireAdminRoleResult).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: UID },
        workspace: { id: WS, name: "w", role: "admin" },
        activeBranchId: null,
      },
    } as never);
    vi.mocked(createClient).mockResolvedValue(client as never);
    // Report that every call produced a fresh upsert.
    vi.mocked(upsertNoteEmbedding).mockResolvedValue(true);

    const result = await reindexWorkspaceAction();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.indexed).toBe(3);
    expect(result.data.failed).toBe(0);
    expect(result.data.skipped).toBe(0);
    expect(result.data.total).toBe(3);
    expect(result.data.status).toBe("complete");
    expect(vi.mocked(upsertNoteEmbedding)).toHaveBeenCalledTimes(3);
  });

  it("counts unchanged notes as skipped (content hash dedup)", async () => {
    const notes = [
      { id: "n1", title: "One", markdown_content: "A" },
      { id: "n2", title: "Two", markdown_content: "B" },
    ];
    const client = makeMock(notes);

    vi.mocked(requireAdminRoleResult).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: UID },
        workspace: { id: WS, name: "w", role: "admin" },
        activeBranchId: null,
      },
    } as never);
    vi.mocked(createClient).mockResolvedValue(client as never);
    // Simulate dedup: upsert returns false → "no work done".
    vi.mocked(upsertNoteEmbedding).mockResolvedValue(false);

    const result = await reindexWorkspaceAction();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.indexed).toBe(0);
    expect(result.data.skipped).toBe(2);
    expect(result.data.failed).toBe(0);
  });

  it("tallies failures when upsertNoteEmbedding throws for some notes", async () => {
    const notes = [
      { id: "n1", title: "One", markdown_content: "A" },
      { id: "n2", title: "Two", markdown_content: "B" },
      { id: "n3", title: "Three", markdown_content: "C" },
    ];
    const client = makeMock(notes);

    vi.mocked(requireAdminRoleResult).mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: UID },
        workspace: { id: WS, name: "w", role: "admin" },
        activeBranchId: null,
      },
    } as never);
    vi.mocked(createClient).mockResolvedValue(client as never);
    vi.mocked(upsertNoteEmbedding).mockImplementation(async (_s, id) => {
      if (id === "n2") throw new Error("boom");
      return true;
    });

    const result = await reindexWorkspaceAction();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.indexed).toBe(2);
    expect(result.data.failed).toBe(1);
  });

  it("rejects non-admin callers with a friendly error", async () => {
    vi.mocked(requireAdminRoleResult).mockResolvedValue({
      ok: false,
      error: "Only admins can perform this action.",
    });

    const result = await reindexWorkspaceAction();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/admin/i);
    // Must not even try to fetch notes.
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
    expect(vi.mocked(upsertNoteEmbedding)).not.toHaveBeenCalled();
  });
});
