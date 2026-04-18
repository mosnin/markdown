import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests for workspace_analytics_service.
 *
 * Uses a structural Supabase mock (same pattern as
 * workspace_search_branch_scope.test.ts) to verify:
 *   - getWorkspaceMetrics returns correct counts
 *   - recordSearchQuery inserts a row
 *   - orphanedNotes returns notes with no links
 *   - getContributorActivity groups by user
 */

import {
  recordSearchQuery,
  getWorkspaceMetrics,
  getContentHealth,
  getContributorActivity,
} from "@/server/services/workspace_analytics_service";

type Row = Record<string, unknown>;

interface MockTableConfig {
  rows: Row[];
  insertedRows: Row[];
}

/**
 * Build a mock Supabase client that serves canned data per table.
 * Supports chained .select(), .eq(), .neq(), .is(), .or(), .gte(),
 * .lt(), .order(), .limit(), .insert(), and head-mode count queries.
 */
function makeMockSupabase(tableData: Record<string, Row[]>) {
  const tables: Record<string, MockTableConfig> = {};
  for (const [name, rows] of Object.entries(tableData)) {
    tables[name] = { rows, insertedRows: [] };
  }

  const from = (table: string) => {
    const config = tables[table] ?? { rows: [], insertedRows: [] };
    if (!tables[table]) tables[table] = config;

    let headMode = false;
    let countMode = false;

    const query: Record<string, unknown> = {};
    Object.assign(query, {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) headMode = true;
        if (opts?.count) countMode = true;
        return query;
      },
      eq: () => query,
      neq: () => query,
      is: () => query,
      or: () => query,
      gte: () => query,
      lt: () => query,
      order: () => query,
      limit: () => query,
      insert: (row: Row | Row[]) => {
        const rows = Array.isArray(row) ? row : [row];
        config.insertedRows.push(...rows);
        return query;
      },
      then: <T>(
        onFulfilled: (v: { data: Row[] | null; count: number | null; error: null }) => T,
      ): Promise<T> => {
        if (headMode && countMode) {
          return Promise.resolve(
            onFulfilled({
              data: null,
              count: config.rows.length,
              error: null,
            }),
          );
        }
        return Promise.resolve(
          onFulfilled({
            data: config.rows,
            count: config.rows.length,
            error: null,
          }),
        );
      },
    });
    return query;
  };

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
  };
}

const WS = "ws-analytics-test";

// ─── recordSearchQuery ──────────────────────────────────────────────────────

describe("recordSearchQuery", () => {
  it("inserts a row into search_analytics", async () => {
    const mock = makeMockSupabase({});
    await recordSearchQuery(mock.client, {
      workspaceId: WS,
      userId: "user-1",
      query: "testing",
      resultCount: 5,
      searchType: "keyword",
    });

    expect(mock.tables.search_analytics.insertedRows).toHaveLength(1);
    expect(mock.tables.search_analytics.insertedRows[0]).toMatchObject({
      workspace_id: WS,
      user_id: "user-1",
      query: "testing",
      result_count: 5,
      search_type: "keyword",
    });
  });

  it("defaults search_type to keyword when omitted", async () => {
    const mock = makeMockSupabase({});
    await recordSearchQuery(mock.client, {
      workspaceId: WS,
      query: "test",
      resultCount: 0,
    });

    expect(mock.tables.search_analytics.insertedRows[0]).toMatchObject({
      search_type: "keyword",
    });
  });

  it("does not throw on error", async () => {
    const broken = {
      from: () => ({
        insert: () => {
          throw new Error("db down");
        },
      }),
    } as unknown as SupabaseClient;

    // Should not throw
    await expect(
      recordSearchQuery(broken, {
        workspaceId: WS,
        query: "test",
        resultCount: 0,
      }),
    ).resolves.toBeUndefined();
  });
});

// ─── getWorkspaceMetrics ────────────────────────────────────────────────────

describe("getWorkspaceMetrics", () => {
  it("returns correct total counts", async () => {
    const mock = makeMockSupabase({
      notes: [
        { id: "n1", title: "A", updated_at: "2026-04-01T00:00:00Z" },
        { id: "n2", title: "B", updated_at: "2026-04-01T00:00:00Z" },
      ],
      files: [{ id: "f1" }],
      folders: [{ id: "fl1" }],
      boxes: [{ id: "b1", name: "Box1" }],
      skills: [],
      agents: [{ id: "a1" }],
      audit_events: [],
      search_analytics: [],
      note_links: [],
    });

    const metrics = await getWorkspaceMetrics(mock.client, WS);

    expect(metrics.totalNotes).toBe(2);
    expect(metrics.totalFiles).toBe(1);
    expect(metrics.totalFolders).toBe(1);
    expect(metrics.totalBoxes).toBe(1);
    expect(metrics.totalSkills).toBe(0);
    expect(metrics.totalAgents).toBe(1);
  });

  it("counts active contributors from audit_events", async () => {
    const mock = makeMockSupabase({
      notes: [],
      files: [],
      folders: [],
      boxes: [],
      skills: [],
      agents: [],
      audit_events: [
        { actor_id: "user-1" },
        { actor_id: "user-1" },
        { actor_id: "user-2" },
      ],
      search_analytics: [],
      note_links: [],
    });

    const metrics = await getWorkspaceMetrics(mock.client, WS);
    expect(metrics.activeContributors).toBe(2);
  });

  it("aggregates top search queries", async () => {
    const mock = makeMockSupabase({
      notes: [],
      files: [],
      folders: [],
      boxes: [],
      skills: [],
      agents: [],
      audit_events: [],
      search_analytics: [
        { query: "React" },
        { query: "react" },
        { query: "react" },
        { query: "TypeScript" },
      ],
      note_links: [],
    });

    const metrics = await getWorkspaceMetrics(mock.client, WS);
    expect(metrics.topSearchQueries[0]).toEqual({
      query: "react",
      count: 3,
    });
    expect(metrics.topSearchQueries[1]).toEqual({
      query: "typescript",
      count: 1,
    });
  });
});

// ─── orphanedNotes ──────────────────────────────────────────────────────────

describe("getContentHealth — orphanedNotes", () => {
  it("returns notes with no links", async () => {
    const mock = makeMockSupabase({
      notes: [
        { id: "n1", title: "Linked", updated_at: "2026-04-01T00:00:00Z" },
        { id: "n2", title: "Orphan", updated_at: "2026-04-02T00:00:00Z" },
      ],
      note_links: [{ source_note_id: "n1", target_note_id: "n3" }],
      folders: [],
    });

    const health = await getContentHealth(mock.client, WS);

    const orphanIds = health.orphanedNotes.map((n) => n.id);
    expect(orphanIds).toContain("n2");
    expect(orphanIds).not.toContain("n1");
  });

  it("returns empty when all notes are linked", async () => {
    const mock = makeMockSupabase({
      notes: [
        { id: "n1", title: "A", updated_at: "2026-04-01T00:00:00Z" },
        { id: "n2", title: "B", updated_at: "2026-04-01T00:00:00Z" },
      ],
      note_links: [
        { source_note_id: "n1", target_note_id: "n2" },
      ],
      folders: [],
    });

    const health = await getContentHealth(mock.client, WS);
    expect(health.orphanedNotes).toHaveLength(0);
  });
});

// ─── getContributorActivity ─────────────────────────────────────────────────

describe("getContributorActivity", () => {
  it("groups events by user and sorts by count", async () => {
    const mock = makeMockSupabase({
      audit_events: [
        { actor_id: "user-a" },
        { actor_id: "user-b" },
        { actor_id: "user-a" },
        { actor_id: "user-a" },
        { actor_id: "user-b" },
      ],
    });

    const activity = await getContributorActivity(mock.client, WS);

    expect(activity).toHaveLength(2);
    expect(activity[0]).toEqual({ userId: "user-a", eventCount: 3 });
    expect(activity[1]).toEqual({ userId: "user-b", eventCount: 2 });
  });

  it("returns empty array when no events", async () => {
    const mock = makeMockSupabase({
      audit_events: [],
    });

    const activity = await getContributorActivity(mock.client, WS);
    expect(activity).toEqual([]);
  });
});
