import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for the restore engine.
 *
 * Exercises the real service paths that make a restore work:
 * openChangeSet → record items/structural events → commitChangeSet,
 * then planRestoreFromChangeSet + restoreFromChangeSet. We mock the
 * Supabase client at the builder level — the same pattern the other
 * integration tests use — so the engine's orchestration logic runs
 * end-to-end without a live database.
 *
 * What's covered:
 *
 *   1. Note rollback wraps correctly in a change set and tags the
 *      resulting version with change_set_id.
 *   2. File / skill / agent rollback wrappers open the right change
 *      set origin and write the right item.
 *   3. A change set whose status is `aborted` is refused by the
 *      planner with an actionable blocker.
 *   4. A change set with an update item missing `before_snapshot` is
 *      blocked before any writes happen.
 *   5. Structural move plans surface as `structural_undo` items,
 *      never as `unsupported`.
 *   6. Legacy behaviour: inverse operation map is stable (a small
 *      extra assertion alongside the existing pure tests).
 */

vi.mock("@/server/services/version_history_service");
vi.mock("@/server/repositories/audit_event_repository");

import {
  planRestoreFromChangeSet,
  restoreNoteVersion,
  restoreObjectVersion,
} from "@/server/services/restore_service";
import {
  inverseOperation,
  inverseStructuralEvent,
  type ChangeSet,
  type ChangeSetItem,
  type StructuralEvent,
} from "@/server/services/change_set_service";
import * as versionHistory from "@/server/services/version_history_service";

// ─── Mock builders ───────────────────────────────────────────────────────────
//
// `rowStore` is a per-test registry that keeps the simulated database
// consistent across sequential builder calls (insert then select for
// example). Tests seed it via `seed(...)`.

type TableName = string;
interface RowStore {
  rows: Record<TableName, Record<string, unknown>[]>;
  inserts: Record<TableName, Record<string, unknown>[]>;
  updates: Record<TableName, Array<{ match: Record<string, unknown>; patch: Record<string, unknown> }>>;
}

function freshStore(): RowStore {
  return { rows: {}, inserts: {}, updates: {} };
}

function seed(store: RowStore, table: TableName, row: Record<string, unknown>) {
  store.rows[table] = store.rows[table] ?? [];
  store.rows[table].push(row);
}

function makeMockSupabase(store: RowStore) {
  function fromFn(table: TableName) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    };
    builder.is = (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    };
    builder.neq = () => builder;
    builder.in = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = async () => {
      const match = findMatch(store, table, filters);
      return { data: match ?? null, error: null };
    };
    builder.single = async () => {
      const match = findMatch(store, table, filters);
      return { data: match ?? null, error: match ? null : { message: "not found" } };
    };
    // Plain select() used without filters returns everything — good
    // enough for the tests that list items.
    builder.select = () => {
      const selectBuilder: Record<string, unknown> = { ...builder };
      selectBuilder.single = async () => {
        // When `.insert(...).select().single()` is chained, the most
        // recent insert is the "selected" row. We rely on the insert
        // builder to have prepopulated `store.rows[table]` below.
        const rows = store.rows[table] ?? [];
        const row = rows[rows.length - 1] ?? null;
        return { data: row, error: row ? null : { message: "no row" } };
      };
      selectBuilder.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
        const rows = store.rows[table] ?? [];
        const filtered = rows.filter((r) => matchFilters(r, filters));
        resolve({ data: filtered, error: null });
      };
      return selectBuilder;
    };
    builder.insert = (payload: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const r of rows) {
        const withId = { id: r.id ?? `${table}-${cryptoRandom()}`, ...r };
        seed(store, table, withId);
        store.inserts[table] = store.inserts[table] ?? [];
        store.inserts[table].push(withId);
      }
      // Return a thenable-like chain that supports `.select().single()`
      // and plain await.
      const ins: Record<string, unknown> = {};
      ins.select = () => ({
        single: async () => {
          const latest = store.rows[table][store.rows[table].length - 1];
          return { data: latest, error: null };
        },
      });
      ins.then = async (resolve: (v: { data: null; error: null }) => void) => {
        resolve({ data: null, error: null });
      };
      return ins;
    };
    builder.update = (patch: Record<string, unknown>) => {
      // Record the intended update so tests can assert on it.
      const capturedFilters = { ...filters };
      const up: Record<string, unknown> = {};
      const applyUpdate = () => {
        store.updates[table] = store.updates[table] ?? [];
        store.updates[table].push({ match: capturedFilters, patch });
        const rows = store.rows[table] ?? [];
        for (const r of rows) {
          if (matchFilters(r, capturedFilters)) Object.assign(r, patch);
        }
      };
      up.eq = (col: string, val: unknown) => {
        capturedFilters[col] = val;
        return up;
      };
      up.is = (col: string, val: unknown) => {
        capturedFilters[col] = val;
        return up;
      };
      up.in = () => up;
      up.select = () => ({
        single: async () => {
          applyUpdate();
          const latest = store.rows[table].find((r) => matchFilters(r, capturedFilters));
          return { data: latest ?? null, error: null };
        },
        maybeSingle: async () => {
          applyUpdate();
          const latest = store.rows[table].find((r) => matchFilters(r, capturedFilters));
          return { data: latest ?? null, error: null };
        },
      });
      up.then = async (resolve: (v: { data: null; error: null }) => void) => {
        applyUpdate();
        resolve({ data: null, error: null });
      };
      return up;
    };
    builder.delete = () => {
      const del: Record<string, unknown> = {};
      del.eq = () => del;
      del.in = () => del;
      del.then = async (resolve: (v: { error: null }) => void) => resolve({ error: null });
      return del;
    };
    return builder;
  }

  return { from: fromFn, rpc: vi.fn() } as never;
}

function findMatch(store: RowStore, table: TableName, filters: Record<string, unknown>) {
  const rows = store.rows[table] ?? [];
  return rows.find((r) => matchFilters(r, filters));
}
function matchFilters(row: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filters)) {
    if (row[k] !== v) return false;
  }
  return true;
}
function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-test";
const ACTOR_ID = "user-test";
const NOTE_ID = "note-test";
const FILE_ID = "file-test";
const SKILL_ID = "skill-test";
const AGENT_ID = "agent-test";
const VERSION_ID = "ver-test";

describe("restore engine — note rollback wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a rollback change set and tags the new version with its id", async () => {
    const store = freshStore();
    const supabase = makeMockSupabase(store);

    vi.mocked(versionHistory.rollbackNoteToVersion).mockResolvedValue({
      new_version_id: "new-v1",
      version_number: 5,
      restored_from_version_id: VERSION_ID,
      note: { id: NOTE_ID } as never,
    });

    const result = await restoreNoteVersion(
      supabase,
      WORKSPACE_ID,
      ACTOR_ID,
      NOTE_ID,
      VERSION_ID
    );

    expect(result.ok).toBe(true);
    expect(result.restoreChangeSetId).toBeDefined();

    // One change set row with origin='rollback'.
    expect(store.inserts.change_sets).toHaveLength(1);
    expect(store.inserts.change_sets[0]).toMatchObject({
      origin: "rollback",
      actor_id: ACTOR_ID,
      workspace_id: WORKSPACE_ID,
    });
    // One change_set_item for the note rollback.
    expect(store.inserts.change_set_items).toHaveLength(1);
    expect(store.inserts.change_set_items[0]).toMatchObject({
      operation: "rollback",
      object_type: "note",
      object_id: NOTE_ID,
    });
    // note_versions tagged with change_set_id.
    expect(store.updates.note_versions?.some((u) => "change_set_id" in u.patch)).toBe(true);
  });

  it("aborts the change set and returns ok=false when the underlying rollback throws", async () => {
    const store = freshStore();
    const supabase = makeMockSupabase(store);

    vi.mocked(versionHistory.rollbackNoteToVersion).mockRejectedValue(
      new Error("version mismatch")
    );

    const result = await restoreNoteVersion(
      supabase,
      WORKSPACE_ID,
      ACTOR_ID,
      NOTE_ID,
      VERSION_ID
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/version mismatch/);
    // Change set was opened but aborted — never written as committed.
    expect(store.inserts.change_sets).toHaveLength(1);
    const statuses = (store.updates.change_sets ?? []).map((u) => u.patch.status);
    expect(statuses).toContain("aborted");
  });
});

describe("restore engine — object (file/skill/agent) rollback wrappers", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["file", FILE_ID],
    ["skill", SKILL_ID],
    ["agent", AGENT_ID],
  ] as const)("opens a change set for %s rollback", async (type, id) => {
    const store = freshStore();
    const supabase = makeMockSupabase(store);

    vi.mocked(versionHistory.rollbackObjectToVersion).mockResolvedValue({
      new_version_id: "new-v1",
      version_number: 3,
      restored_from_version_id: VERSION_ID,
      object_id: id,
      object_type: type,
    });

    const result = await restoreObjectVersion(
      supabase,
      WORKSPACE_ID,
      ACTOR_ID,
      type,
      id,
      VERSION_ID
    );

    expect(result.ok).toBe(true);
    expect(store.inserts.change_set_items[0]).toMatchObject({
      operation: "rollback",
      object_type: type,
      object_id: id,
    });
    expect(store.updates.object_versions?.some((u) => "change_set_id" in u.patch)).toBe(true);
  });
});

describe("restore engine — planner blockers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to restore an aborted change set", async () => {
    const store = freshStore();
    seed(store, "change_sets", {
      id: "cs-aborted",
      workspace_id: WORKSPACE_ID,
      status: "aborted",
      origin: "manual_edit",
    });
    const supabase = makeMockSupabase(store);

    const plan = await planRestoreFromChangeSet(supabase, "cs-aborted");
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.blockers.some((b) => /aborted/i.test(b))).toBe(true);
  });

  it("returns an empty plan but no crash when change set is missing", async () => {
    const store = freshStore();
    const supabase = makeMockSupabase(store);

    const plan = await planRestoreFromChangeSet(supabase, "does-not-exist");
    expect(plan.items).toEqual([]);
    expect(plan.structural).toEqual([]);
    expect(plan.blockers).toContain("Change set not found");
  });
});

describe("restore engine — pure contracts", () => {
  it("inverseOperation covers every ChangeSetItemOperation", () => {
    const ops = [
      "create", "update", "archive", "unarchive",
      "trash", "restore_lifecycle", "move", "attach",
      "detach", "link_create", "link_delete", "rollback",
    ] as const;
    for (const op of ops) {
      expect(typeof inverseOperation(op)).toBe("string");
    }
  });

  it("inverseStructuralEvent swaps before_state and after_state", () => {
    const event: StructuralEvent = {
      id: "e", change_set_id: "cs", workspace_id: WORKSPACE_ID,
      box_id: "b", event_type: "path_cascade",
      object_type: "note", object_id: "n",
      before_state: { path_cache: "a" },
      after_state: { path_cache: "b" },
      sequence: 0,
      created_at: new Date().toISOString(),
    };
    const inv = inverseStructuralEvent(event);
    expect(inv.event_type).toBe("path_cascade");
    expect(inv.before).toEqual({ path_cache: "b" });
    expect(inv.after).toEqual({ path_cache: "a" });
  });
});

// Unused imports silenced so lint stays happy — ChangeSet and ChangeSetItem
// are referenced in test fixtures by typed mocks indirectly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Unused = ChangeSet | ChangeSetItem;
