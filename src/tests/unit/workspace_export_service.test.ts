import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for workspace export/import service.
 *
 * Invariants:
 *   1. Export includes boxes and notes from the workspace.
 *   2. Import in skip mode does not overwrite existing rows.
 *   3. Round-trip: export then import into empty workspace matches.
 *
 * Mocking strategy: in-memory tables behind a fake Supabase client.
 */

import { exportWorkspace, importWorkspace } from "@/server/services/workspace_export_service";
import { type WorkspaceExport } from "@/server/domain/types/workspace_export";

// ─── In-memory store ──────────────────────────────────────────────────────

interface FakeStore {
  [table: string]: Record<string, unknown>[];
}

function makeFakeSupabase(store: FakeStore) {
  return {
    from(table: string) {
      if (!store[table]) store[table] = [];
      const rows = store[table];
      let filters: { col: string; op: string; val: unknown }[] = [];
      let orFilter: string | null = null;
      let orderCol: string | null = null;
      let selectCols: string | null = null;
      let pendingInsert: Record<string, unknown> | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      let useMaybeSingle = false;

      function applyFilters(data: Record<string, unknown>[]) {
        let result = data;
        for (const f of filters) {
          if (f.op === "eq") {
            result = result.filter((r) => r[f.col] === f.val);
          } else if (f.op === "neq") {
            result = result.filter((r) => r[f.col] !== f.val);
          } else if (f.op === "is") {
            result = result.filter((r) => r[f.col] === f.val);
          } else if (f.op === "in") {
            const vals = f.val as unknown[];
            result = result.filter((r) => vals.includes(r[f.col]));
          }
        }
        if (orFilter) {
          // Simplified or filter for note_links: parse source_note_id.in.(...) patterns
          const inMatches = [...orFilter.matchAll(/(\w+)\.in\.\(([^)]+)\)/g)];
          if (inMatches.length > 0) {
            result = result.filter((r) =>
              inMatches.some((m) => {
                const col = m[1];
                const vals = m[2].split(",");
                return vals.includes(r[col] as string);
              }),
            );
          }
        }
        return result;
      }

      function projectCols(row: Record<string, unknown>): Record<string, unknown> {
        if (!selectCols || selectCols === "*") return { ...row };
        const cols = selectCols.split(",").map((c) => c.trim());
        const out: Record<string, unknown> = {};
        for (const c of cols) {
          if (c in row) out[c] = row[c];
        }
        return out;
      }

      const chain: Record<string, unknown> = {
        select(cols?: string) {
          selectCols = cols ?? "*";
          return chain;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, op: "eq", val });
          return chain;
        },
        neq(col: string, val: unknown) {
          filters.push({ col, op: "neq", val });
          return chain;
        },
        is(col: string, val: unknown) {
          filters.push({ col, op: "is", val });
          return chain;
        },
        in(col: string, vals: unknown[]) {
          filters.push({ col, op: "in", val: vals });
          return chain;
        },
        or(expr: string) {
          orFilter = expr;
          return chain;
        },
        order(col: string) {
          orderCol = col;
          return chain;
        },
        insert(row: Record<string, unknown>) {
          pendingInsert = row;
          // Check for duplicate id
          const existing = rows.find((r) => r.id === row.id);
          if (existing) {
            return {
              select() {
                return {
                  single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }),
                };
              },
              then: async (resolve: (v: unknown) => void) => resolve({ data: null, error: { code: "23505", message: "duplicate" } }),
            };
          }
          rows.push({ ...row });
          return {
            select() {
              return {
                single: async () => ({ data: { ...row }, error: null }),
              };
            },
            then: async (resolve: (v: unknown) => void) => resolve({ data: { ...row }, error: null }),
          };
        },
        update(fields: Record<string, unknown>) {
          pendingUpdate = fields;
          return chain;
        },
        async single() {
          const matched = applyFilters(rows);
          if (pendingUpdate && matched.length > 0) {
            Object.assign(matched[0], pendingUpdate);
            pendingUpdate = null;
            return { data: projectCols(matched[0]), error: null };
          }
          const row = matched[0] ?? null;
          return { data: row ? projectCols(row) : null, error: row ? null : { message: "not found" } };
        },
        async maybeSingle() {
          const matched = applyFilters(rows);
          if (pendingUpdate && matched.length > 0) {
            Object.assign(matched[0], pendingUpdate);
            pendingUpdate = null;
            return { data: projectCols(matched[0]), error: null };
          }
          const row = matched[0] ?? null;
          return { data: row ? projectCols(row) : null, error: null };
        },
        then: undefined as unknown,
      };

      // Make the chain thenable for insert/queries that don't end with single()
      (chain as Record<string, unknown>).then = async function (resolve: (v: unknown) => void) {
        if (pendingUpdate) {
          const matched = applyFilters(rows);
          for (const m of matched) Object.assign(m, pendingUpdate);
          pendingUpdate = null;
          return resolve({ data: matched, error: null });
        }
        const matched = applyFilters(rows);
        const result = matched.map(projectCols);
        return resolve({ data: result, error: null });
      };

      return chain;
    },
  } as unknown;
}

// ─── Test data ─────────────────────────────────────────────────────────────

function seedWorkspace(): FakeStore {
  return {
    workspaces: [
      { id: "ws-1", name: "Test Workspace", slug: "test-ws" },
    ],
    boxes: [
      {
        id: "box-1", workspace_id: "ws-1", name: "Box A", slug: "box-a",
        description: "First box", status: "active", guide_note_id: null,
        branch_id: null, created_at: "2025-01-01", updated_at: "2025-01-01",
      },
    ],
    folders: [
      {
        id: "folder-1", workspace_id: "ws-1", box_id: "box-1",
        parent_folder_id: null, name: "Research", slug: "research",
        path_cache: "/research", description: null, status: "active",
        branch_id: null, created_at: "2025-01-01", updated_at: "2025-01-01",
      },
    ],
    notes: [
      {
        id: "note-1", box_id: "box-1", folder_id: "folder-1",
        title: "Note One", slug: "note-one", path_cache: "/research/note-one",
        markdown_content: "# Note One\n\nContent here.",
        content_bytes: 26, tags: ["test"], status: "active",
        summary: "A test note", origin_type: "human",
        is_generated: false, branch_id: null,
        created_at: "2025-01-01", updated_at: "2025-01-01",
        current_version_id: null, read_hint: null, retrieval_priority: 5,
        kind: "note", generated_by_connection_id: null,
      },
      {
        id: "note-2", box_id: "box-1", folder_id: null,
        title: "Note Two", slug: "note-two", path_cache: "/note-two",
        markdown_content: "# Note Two\n\nMore content.",
        content_bytes: 27, tags: [], status: "active",
        summary: null, origin_type: "human",
        is_generated: false, branch_id: null,
        created_at: "2025-01-01", updated_at: "2025-01-01",
        current_version_id: null, read_hint: null, retrieval_priority: 5,
        kind: "note", generated_by_connection_id: null,
      },
    ],
    files: [],
    skills: [],
    agents: [],
    note_links: [
      {
        id: "nl-1", source_note_id: "note-1", target_note_id: "note-2",
        relationship_type: "related_to", relationship_note: null,
        branch_id: null, created_at: "2025-01-01",
      },
    ],
    object_links: [],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("exportWorkspace", () => {
  it("includes boxes and notes from the workspace", async () => {
    const store = seedWorkspace();
    const supabase = makeFakeSupabase(store);

    const result = await exportWorkspace(supabase as never, "ws-1");

    expect(result.version).toBe("1.0");
    expect(result.workspace.id).toBe("ws-1");
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0].name).toBe("Box A");
    expect(result.notes).toHaveLength(2);
    expect(result.notes.map((n) => n.title).sort()).toEqual(["Note One", "Note Two"]);
    expect(result.folders).toHaveLength(1);
    expect(result.note_links).toHaveLength(1);
  });
});

describe("importWorkspace — skip mode", () => {
  it("skips existing rows when collision mode is skip", async () => {
    const store = seedWorkspace();
    const supabase = makeFakeSupabase(store);

    // Export first
    const exported = await exportWorkspace(supabase as never, "ws-1");

    // Import into the same store (same ids exist)
    const result = await importWorkspace(
      supabase as never,
      "ws-1",
      "user-1",
      exported,
      "skip",
    );

    expect(result.boxes.skipped).toBe(1);
    expect(result.boxes.created).toBe(0);
    expect(result.notes.skipped).toBe(2);
    expect(result.notes.created).toBe(0);
    expect(result.folders.skipped).toBe(1);
    expect(result.note_links.skipped).toBe(1);
  });
});

describe("importWorkspace — round-trip", () => {
  it("exports then imports into empty workspace with matching counts", async () => {
    const sourceStore = seedWorkspace();
    const sourceSupabase = makeFakeSupabase(sourceStore);

    const exported = await exportWorkspace(sourceSupabase as never, "ws-1");

    // Empty target store
    const targetStore: FakeStore = {
      workspaces: [{ id: "ws-2", name: "Target", slug: "target" }],
      boxes: [],
      folders: [],
      notes: [],
      files: [],
      skills: [],
      agents: [],
      note_links: [],
      object_links: [],
    };
    const targetSupabase = makeFakeSupabase(targetStore);

    const result = await importWorkspace(
      targetSupabase as never,
      "ws-2",
      "user-2",
      exported,
      "skip",
    );

    expect(result.boxes.created).toBe(1);
    expect(result.folders.created).toBe(1);
    expect(result.notes.created).toBe(2);
    expect(result.note_links.created).toBe(1);

    // Verify the data is in the target store
    expect(targetStore.boxes).toHaveLength(1);
    expect(targetStore.notes).toHaveLength(2);
    expect(targetStore.folders).toHaveLength(1);
    expect(targetStore.note_links).toHaveLength(1);

    // Verify workspace_id was remapped on boxes
    expect(targetStore.boxes[0].workspace_id).toBe("ws-2");
  });
});
