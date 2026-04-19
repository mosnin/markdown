import { describe, it, expect } from "vitest";

import {
  AGENT_TOOL_NAMES,
  DEFAULT_USER_AGENT_PREFERENCES,
  getUserAgentPreferences,
  upsertUserAgentPreferences,
} from "@/server/services/user_agent_preferences_service";

// ─── Fake Supabase chain ─────────────────────────────────────────────────────
//
// We only ever exercise:
//   from(table).select("*").eq("user_id", id).maybeSingle()
//   from(table).upsert(payload, { onConflict: "user_id" }).select("*").single()

interface QueryRecord {
  table: string;
  op: "select" | "upsert";
  payload?: Record<string, unknown>;
  onConflict?: string;
  filters: Array<{ col: string; val: unknown }>;
}

function makeSupabase(opts: {
  singleRow?: Record<string, unknown> | null;
  upsertedRow?: Record<string, unknown>;
}) {
  const queries: QueryRecord[] = [];

  function builder(table: string) {
    const record: QueryRecord = { table, op: "select", filters: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};

    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      record.filters.push({ col, val });
      return b;
    };
    b.upsert = (payload: Record<string, unknown>, opts2?: { onConflict?: string }) => {
      record.op = "upsert";
      record.payload = payload;
      record.onConflict = opts2?.onConflict;
      return b;
    };
    b.single = async () => {
      queries.push(record);
      if (record.op === "upsert") {
        return { data: opts.upsertedRow ?? record.payload, error: null };
      }
      return { data: opts.singleRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      queries.push(record);
      return { data: opts.singleRow ?? null, error: null };
    };
    return b;
  }

  return { from: builder, queries };
}

// ─── DEFAULT_USER_AGENT_PREFERENCES sanity ───────────────────────────────────

describe("DEFAULT_USER_AGENT_PREFERENCES", () => {
  it("matches the column DEFAULT clauses in the migration", () => {
    expect(DEFAULT_USER_AGENT_PREFERENCES.tone).toBe("neutral");
    expect(DEFAULT_USER_AGENT_PREFERENCES.citation_style).toBe("inline");
    expect(DEFAULT_USER_AGENT_PREFERENCES.must_cite_per_claim).toBe(false);
    expect(DEFAULT_USER_AGENT_PREFERENCES.max_tool_calls).toBe(20);
    expect(DEFAULT_USER_AGENT_PREFERENCES.tool_allowlist).toEqual([
      ...AGENT_TOOL_NAMES,
    ]);
    // Ensure the constant is a deep copy, not a reference back to the const.
    expect(DEFAULT_USER_AGENT_PREFERENCES.tool_allowlist).not.toBe(
      AGENT_TOOL_NAMES
    );
  });
});

// ─── getUserAgentPreferences ─────────────────────────────────────────────────

describe("getUserAgentPreferences", () => {
  it("returns null when no row exists", async () => {
    const sb = makeSupabase({ singleRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getUserAgentPreferences(sb as any, "user-1");
    expect(result).toBeNull();
    expect(sb.queries[0].table).toBe("user_agent_preferences");
    expect(sb.queries[0].filters).toContainEqual({
      col: "user_id",
      val: "user-1",
    });
  });

  it("returns the row when present", async () => {
    const row = {
      user_id: "user-1",
      tone: "formal",
      citation_style: "footnote",
      tool_allowlist: ["hybrid_search", "draft_note"],
      must_cite_per_claim: true,
      max_tool_calls: 30,
      created_at: "2026-04-19T00:00:00Z",
      updated_at: "2026-04-19T00:00:00Z",
    };
    const sb = makeSupabase({ singleRow: row });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getUserAgentPreferences(sb as any, "user-1");
    expect(result?.tone).toBe("formal");
    expect(result?.max_tool_calls).toBe(30);
  });
});

// ─── upsertUserAgentPreferences ──────────────────────────────────────────────

describe("upsertUserAgentPreferences", () => {
  it("inserts a new row using onConflict=user_id", async () => {
    const upserted = {
      user_id: "user-1",
      tone: "casual",
      citation_style: "inline",
      tool_allowlist: ["hybrid_search"],
      must_cite_per_claim: false,
      max_tool_calls: 15,
      created_at: "2026-04-19T00:00:00Z",
      updated_at: "2026-04-19T00:00:00Z",
    };
    const sb = makeSupabase({ upsertedRow: upserted });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await upsertUserAgentPreferences(sb as any, "user-1", {
      tone: "casual",
      tool_allowlist: ["hybrid_search"],
      max_tool_calls: 15,
    });
    expect(row.user_id).toBe("user-1");
    expect(row.tone).toBe("casual");

    const q = sb.queries[0];
    expect(q.op).toBe("upsert");
    expect(q.onConflict).toBe("user_id");
    expect(q.payload).toMatchObject({
      user_id: "user-1",
      tone: "casual",
      tool_allowlist: ["hybrid_search"],
      max_tool_calls: 15,
    });
  });

  it("updates an existing row with a partial patch", async () => {
    const upserted = {
      user_id: "user-1",
      tone: "neutral",
      citation_style: "endnote",
      tool_allowlist: AGENT_TOOL_NAMES,
      must_cite_per_claim: true,
      max_tool_calls: 20,
    };
    const sb = makeSupabase({ upsertedRow: upserted });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await upsertUserAgentPreferences(sb as any, "user-1", {
      citation_style: "endnote",
      must_cite_per_claim: true,
    });
    expect(row.citation_style).toBe("endnote");
    expect(row.must_cite_per_claim).toBe(true);

    const q = sb.queries[0];
    expect(q.payload).toEqual({
      user_id: "user-1",
      citation_style: "endnote",
      must_cite_per_claim: true,
    });
  });

  it("strips unknown tools from the allowlist before write", async () => {
    const sb = makeSupabase({ upsertedRow: { user_id: "user-1" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertUserAgentPreferences(sb as any, "user-1", {
      tool_allowlist: [
        "hybrid_search",
        "draft_note",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "rm_rf_root" as any,
      ],
    });
    const q = sb.queries[0];
    expect(q.payload?.tool_allowlist).toEqual(["hybrid_search", "draft_note"]);
  });

  it("clamps max_tool_calls to the [1, 100] range", async () => {
    const sb = makeSupabase({ upsertedRow: { user_id: "user-1" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertUserAgentPreferences(sb as any, "user-1", {
      max_tool_calls: 999,
    });
    expect(sb.queries[0].payload?.max_tool_calls).toBe(100);

    const sb2 = makeSupabase({ upsertedRow: { user_id: "user-1" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertUserAgentPreferences(sb2 as any, "user-1", {
      max_tool_calls: -5,
    });
    expect(sb2.queries[0].payload?.max_tool_calls).toBe(1);
  });

  it("deduplicates tool entries", async () => {
    const sb = makeSupabase({ upsertedRow: { user_id: "user-1" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertUserAgentPreferences(sb as any, "user-1", {
      tool_allowlist: ["draft_note", "draft_note", "read_note"],
    });
    expect(sb.queries[0].payload?.tool_allowlist).toEqual([
      "draft_note",
      "read_note",
    ]);
  });
});
