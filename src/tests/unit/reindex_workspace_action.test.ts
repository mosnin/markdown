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
 * Build a minimal Supabase-like mock that supports the exact chains the
 * reindex action uses:
 *   1. boxes:      `.from("boxes").select("id").eq("workspace_id", ws)` → box ids
 *   2. notes count `.from("notes").select("id", {count,head}).in().neq().is()`
 *   3. notes rows  `.from("notes").select(cols).in().neq().is().order().limit()`
 *
 * Note membership is resolved through `notes.box_id → boxes.workspace_id`, so
 * the boxes lookup MUST return at least one id — otherwise the action treats
 * the workspace as empty and reports 0 eligible notes.
 */
function makeMock(notes: Array<{ id: string; title: string; markdown_content: string | null }>) {
  const BOX_ID = "box-1";

  const from = vi.fn((table: string) => {
    if (table === "boxes") {
      // `.select("id").eq("workspace_id", ws)` is awaited directly.
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => Promise.resolve({ data: [{ id: BOX_ID }], error: null }),
      };
      return chain;
    }

    if (table === "notes") {
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          const result = opts?.head
            ? { count: notes.length, data: null, error: null }
            : { data: notes, error: null };
          // The count query awaits the chain at `.is()`; the rows query awaits
          // the promise from `.limit()`. Make the chain both thenable and
          // further-chainable so a single shape serves both.
          const chain: Record<string, unknown> = {
            in: () => chain,
            neq: () => chain,
            is: () => chain,
            order: () => chain,
            limit: () => Promise.resolve(result),
            then: (resolve: (r: unknown) => unknown) => resolve(result),
          };
          return chain;
        },
      };
    }

    return { select: () => ({ in: () => ({}), eq: () => ({}) }) };
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
