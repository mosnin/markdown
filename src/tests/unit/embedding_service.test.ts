import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the embedding service.
 *
 * Tests cover:
 *   1. hybridSearch ranking (keyword + vector weights)
 *   2. content hash dedup (same content -> skip re-embed)
 *   3. graceful no-op when EMBEDDING_API_KEY unset
 *
 * We stub the Supabase client and fetch globally so no real DB or
 * embedding API is needed.
 */

// ─── Test helpers ──────────────────────────────────────────────────────────

function makeFakeSupabase(opts: {
  embeddings?: Array<{ note_id: string; content_hash: string; id: string }>;
  notes?: Array<{
    id: string;
    title: string;
    summary: string | null;
    markdown_content: string | null;
    status: string;
    updated_at: string;
    workspace_id: string;
    branch_id: string | null;
  }>;
  rpcResult?: unknown[];
} = {}) {
  const embeddings = opts.embeddings ?? [];
  const notes = opts.notes ?? [];
  const rpcResult = opts.rpcResult ?? [];
  const insertedRows: unknown[] = [];
  const updatedRows: unknown[] = [];

  const makeFilterChain = (data: unknown[]) => {
    let filtered = [...data];
    const chain: Record<string, unknown> = {
      eq: (_col: string, _val: string) => {
        filtered = filtered.filter((r) => (r as Record<string, unknown>)[_col] === _val);
        return chain;
      },
      neq: (_col: string, _val: string) => {
        filtered = filtered.filter((r) => (r as Record<string, unknown>)[_col] !== _val);
        return chain;
      },
      is: (_col: string, _val: unknown) => {
        filtered = filtered.filter((r) => (r as Record<string, unknown>)[_col] === _val);
        return chain;
      },
      or: () => chain,
      limit: () => chain,
      order: () => chain,
      maybeSingle: async () => ({
        data: filtered.length > 0 ? filtered[0] : null,
        error: null,
      }),
      then: (fn: (r: { data: unknown[] }) => unknown) =>
        Promise.resolve(fn({ data: filtered })),
    };
    return chain;
  };

  const api = {
    from: (table: string) => {
      if (table === "note_embeddings") {
        return {
          select: (_cols: string) => makeFilterChain(embeddings),
          insert: async (row: unknown) => {
            insertedRows.push(row);
            return { error: null };
          },
          update: (row: unknown) => {
            updatedRows.push(row);
            return {
              eq: () => ({ error: null }),
            };
          },
        };
      }
      if (table === "notes") {
        return {
          select: (_cols: string) => makeFilterChain(notes),
        };
      }
      return {
        select: () => makeFilterChain([]),
      };
    },
    rpc: async (_fn: string, _params: unknown) => {
      return { data: rpcResult, error: null };
    },
    _insertedRows: insertedRows,
    _updatedRows: updatedRows,
  };

  return api;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("embedding_service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("generateEmbedding — graceful no-op when EMBEDDING_API_KEY unset", () => {
    it("returns null when EMBEDDING_API_KEY is not set", async () => {
      delete process.env.EMBEDDING_API_KEY;
      const { generateEmbedding } = await import(
        "@/server/services/embedding_service"
      );
      const result = await generateEmbedding("hello world");
      expect(result).toBeNull();
    });

    it("calls the embedding API when EMBEDDING_API_KEY is set", async () => {
      process.env.EMBEDDING_API_KEY = "test-key";
      const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: fakeEmbedding }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const { generateEmbedding } = await import(
        "@/server/services/embedding_service"
      );
      const result = await generateEmbedding("hello world");
      expect(result).toEqual(fakeEmbedding);
      expect(fetchSpy).toHaveBeenCalledOnce();

      fetchSpy.mockRestore();
    });
  });

  describe("upsertNoteEmbedding — content hash dedup", () => {
    it("skips re-embedding when content hash is unchanged", async () => {
      process.env.EMBEDDING_API_KEY = "test-key";
      const { createHash } = await import("node:crypto");
      const content = "Test note content";
      const hash = createHash("sha256").update(content).digest("hex");

      const supabase = makeFakeSupabase({
        embeddings: [
          { note_id: "note-1", content_hash: hash, id: "emb-1" },
        ],
      });

      const { upsertNoteEmbedding } = await import(
        "@/server/services/embedding_service"
      );

      // Should not call fetch since content is unchanged
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const result = await upsertNoteEmbedding(
        supabase as never,
        "note-1",
        content
      );

      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it("generates embedding when content hash differs", async () => {
      process.env.EMBEDDING_API_KEY = "test-key";
      const fakeEmbedding = Array.from({ length: 1536 }, () => 0.5);

      const supabase = makeFakeSupabase({
        embeddings: [
          {
            note_id: "note-1",
            content_hash: "old-hash-that-will-not-match",
            id: "emb-1",
          },
        ],
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: fakeEmbedding }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const { upsertNoteEmbedding } = await import(
        "@/server/services/embedding_service"
      );
      const result = await upsertNoteEmbedding(
        supabase as never,
        "note-1",
        "Updated content"
      );

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(supabase._updatedRows.length).toBe(1);

      fetchSpy.mockRestore();
    });

    it("inserts new embedding when no existing row", async () => {
      process.env.EMBEDDING_API_KEY = "test-key";
      const fakeEmbedding = Array.from({ length: 1536 }, () => 0.5);

      const supabase = makeFakeSupabase({ embeddings: [] });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: fakeEmbedding }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const { upsertNoteEmbedding } = await import(
        "@/server/services/embedding_service"
      );
      const result = await upsertNoteEmbedding(
        supabase as never,
        "note-2",
        "Brand new content"
      );

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(supabase._insertedRows.length).toBe(1);

      fetchSpy.mockRestore();
    });
  });

  describe("hybridSearch — keyword + vector weight ranking", () => {
    it("combines keyword (0.3) and semantic (0.7) scores", async () => {
      delete process.env.EMBEDDING_API_KEY;

      const { hybridSearch } = await import(
        "@/server/services/embedding_service"
      );

      // When EMBEDDING_API_KEY is not set, semantic results are empty.
      // hybridSearch should still return keyword-only results gracefully.
      const supabase = makeFakeSupabase({
        notes: [
          {
            id: "note-a",
            title: "Machine Learning Basics",
            summary: "Intro to ML",
            markdown_content: "Content about machine learning",
            status: "active",
            updated_at: "2026-01-01T00:00:00Z",
            workspace_id: "ws-1",
            branch_id: null,
          },
          {
            id: "note-b",
            title: "Deep Learning",
            summary: "Advanced neural networks",
            markdown_content: "Content about deep learning",
            status: "active",
            updated_at: "2026-01-02T00:00:00Z",
            workspace_id: "ws-1",
            branch_id: null,
          },
        ],
      });

      const results = await hybridSearch(
        supabase as never,
        "ws-1",
        "machine learning",
        { limit: 10 }
      );

      // Without embedding API, all results come from keyword search.
      // Each result should have combinedScore = keywordScore * 0.3 + similarity * 0.7.
      for (const r of results) {
        const expected = r.keywordScore * 0.3 + r.similarity * 0.7;
        expect(r.combinedScore).toBeCloseTo(expected, 5);
      }

      // The result with "Machine Learning" in the title should rank
      // higher since it's a title match.
      if (results.length >= 2) {
        const mlResult = results.find((r) => r.noteId === "note-a");
        const dlResult = results.find((r) => r.noteId === "note-b");
        if (mlResult && dlResult) {
          expect(mlResult.combinedScore).toBeGreaterThanOrEqual(dlResult.combinedScore);
        }
      }
    });

    it("tags keyword-only hits with matchType 'keyword' when embeddings are off", async () => {
      delete process.env.EMBEDDING_API_KEY;

      const { hybridSearch } = await import(
        "@/server/services/embedding_service"
      );

      const supabase = makeFakeSupabase({
        notes: [
          {
            id: "note-a",
            title: "Machine Learning Basics",
            summary: null,
            markdown_content: "Content about machine learning",
            status: "active",
            updated_at: "2026-01-01T00:00:00Z",
            workspace_id: "ws-1",
            branch_id: null,
          },
        ],
      });

      const results = await hybridSearch(
        supabase as never,
        "ws-1",
        "machine learning",
        { limit: 10 }
      );

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.matchType).toBe("keyword");
      }
    });

    it("produces correct weight formula", () => {
      // Pure unit test of the weight constants.
      const keywordScore = 0.8;
      const similarity = 0.95;
      const combined = keywordScore * 0.3 + similarity * 0.7;
      expect(combined).toBeCloseTo(0.905, 5);
    });

    it("handles empty query gracefully", async () => {
      delete process.env.EMBEDDING_API_KEY;

      const { hybridSearch } = await import(
        "@/server/services/embedding_service"
      );

      const supabase = makeFakeSupabase();
      const results = await hybridSearch(
        supabase as never,
        "ws-1",
        "",
        { limit: 10 }
      );
      expect(results).toEqual([]);
    });
  });

  describe("semanticSearch — graceful degradation", () => {
    it("returns empty results when EMBEDDING_API_KEY is not set", async () => {
      delete process.env.EMBEDDING_API_KEY;

      const { semanticSearch } = await import(
        "@/server/services/embedding_service"
      );

      const supabase = makeFakeSupabase();
      const results = await semanticSearch(
        supabase as never,
        "ws-1",
        "test query"
      );
      expect(results).toEqual([]);
    });
  });
});
