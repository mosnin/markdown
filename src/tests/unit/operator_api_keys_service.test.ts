import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import {
  createApiKey,
  verifyApiKey,
  revokeApiKey,
  listApiKeysForUser,
  parseOperatorBearer,
  OPERATOR_API_KEY_PREFIX,
} from "@/server/services/operator_api_keys_service";

// ─── Fake Supabase ──────────────────────────────────────────────────────────
//
// Captures the last write payload so tests can prove the raw key never
// touches the DB. Supports the small chain the api keys service exercises.

interface QueryRecord {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown; cmp: "eq" | "is" }>;
}

interface FakeOpts {
  insertedRow?: Record<string, unknown> | null;
  selectRow?: Record<string, unknown> | null;
  selectRows?: Array<Record<string, unknown>>;
  updatedRows?: Array<Record<string, unknown>>;
}

function makeSupabase(opts: FakeOpts) {
  const queries: QueryRecord[] = [];
  function builder(table: string) {
    const record: QueryRecord = { table, op: "select", filters: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};
    b.insert = (payload: Record<string, unknown>) => {
      record.op = "insert";
      record.payload = payload;
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      record.op = "update";
      record.payload = payload;
      return b;
    };
    b.delete = () => {
      record.op = "delete";
      return b;
    };
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "eq" });
      return b;
    };
    b.is = (col: string, val: unknown) => {
      record.filters.push({ col, val, cmp: "is" });
      return b;
    };
    b.order = () => b;
    b.single = async () => {
      queries.push(record);
      if (record.op === "insert") {
        return {
          data: opts.insertedRow ?? null,
          error: opts.insertedRow ? null : { message: "no row" },
        };
      }
      return { data: opts.selectRow ?? null, error: null };
    };
    b.maybeSingle = async () => {
      queries.push(record);
      return { data: opts.selectRow ?? null, error: null };
    };
    b.then = (resolve: (v: unknown) => void) => {
      queries.push(record);
      if (record.op === "update") {
        resolve({ data: opts.updatedRows ?? [], error: null });
        return;
      }
      resolve({ data: opts.selectRows ?? [], error: null });
    };
    return b;
  }
  return { from: builder, queries };
}

// ─── createApiKey ───────────────────────────────────────────────────────────

describe("createApiKey", () => {
  it("generates a wopr_ key, stores ONLY the sha256 hash, and never persists the raw key", async () => {
    const fake = makeSupabase({
      insertedRow: { id: "k-1", created_at: "2026-04-20T00:00:00Z" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await createApiKey(fake as any, {
      userId: "u-1",
      workspaceId: "ws-1",
      name: "CI bot",
    });

    // Raw key has the right shape.
    expect(result.rawKey.startsWith(OPERATOR_API_KEY_PREFIX)).toBe(true);
    expect(result.rawKey.length).toBe(OPERATOR_API_KEY_PREFIX.length + 32);
    expect(result.prefix.length).toBe(12);
    expect(result.id).toBe("k-1");

    const insertQ = fake.queries.find((q) => q.op === "insert");
    expect(insertQ).toBeDefined();
    const payload = insertQ!.payload!;

    // The persisted hash must equal sha256(rawKey) — and the raw key
    // itself must NEVER appear in the payload.
    const expectedHash = createHash("sha256").update(result.rawKey).digest("hex");
    expect(payload.key_hash).toBe(expectedHash);
    expect(JSON.stringify(payload)).not.toContain(result.rawKey);
    expect(payload.key_prefix).toBe(result.prefix);
  });

  it("rejects empty / oversized names", async () => {
    const fake = makeSupabase({});
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createApiKey(fake as any, { userId: "u", workspaceId: "ws", name: " " })
    ).rejects.toThrow(/required/);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createApiKey(fake as any, {
        userId: "u",
        workspaceId: "ws",
        name: "x".repeat(81),
      })
    ).rejects.toThrow(/80 characters/);
  });
});

// ─── verifyApiKey ───────────────────────────────────────────────────────────

describe("verifyApiKey", () => {
  it("rejects keys without the wopr_ prefix immediately", async () => {
    const out = await verifyApiKey("sk_live_abc123");
    expect(out).toBeNull();
  });

  it("rejects keys with the wrong length", async () => {
    const out = await verifyApiKey(`${OPERATOR_API_KEY_PREFIX}deadbeef`);
    expect(out).toBeNull();
  });

  it("rejects keys whose suffix is not hex", async () => {
    const out = await verifyApiKey(`${OPERATOR_API_KEY_PREFIX}${"z".repeat(32)}`);
    expect(out).toBeNull();
  });

  it("returns userId/workspaceId on a hash match against an unrevoked row", async () => {
    const rawKey = `${OPERATOR_API_KEY_PREFIX}${"a".repeat(32)}`;
    const expectedHash = createHash("sha256").update(rawKey).digest("hex");
    const fake = makeSupabase({
      selectRow: {
        id: "k-9",
        user_id: "u-9",
        workspace_id: "ws-9",
        key_hash: expectedHash,
        revoked_at: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await verifyApiKey(rawKey, () => fake as any);
    expect(out).toEqual({ id: "k-9", userId: "u-9", workspaceId: "ws-9" });
  });

  it("rejects revoked keys", async () => {
    const rawKey = `${OPERATOR_API_KEY_PREFIX}${"b".repeat(32)}`;
    const expectedHash = createHash("sha256").update(rawKey).digest("hex");
    const fake = makeSupabase({
      selectRow: {
        id: "k-10",
        user_id: "u-10",
        workspace_id: "ws-10",
        key_hash: expectedHash,
        revoked_at: "2026-04-19T00:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await verifyApiKey(rawKey, () => fake as any);
    expect(out).toBeNull();
  });

  it("returns null when no row matches the hash", async () => {
    const rawKey = `${OPERATOR_API_KEY_PREFIX}${"c".repeat(32)}`;
    const fake = makeSupabase({ selectRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await verifyApiKey(rawKey, () => fake as any);
    expect(out).toBeNull();
  });
});

// ─── revokeApiKey ───────────────────────────────────────────────────────────

describe("revokeApiKey", () => {
  it("stamps revoked_at scoped to the caller", async () => {
    const fake = makeSupabase({ updatedRows: [{ id: "k-1" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await revokeApiKey(fake as any, "k-1", "u-1");
    expect(ok).toBe(true);
    const q = fake.queries[0];
    expect(q?.op).toBe("update");
    expect(q?.payload).toMatchObject({});
    expect(typeof (q?.payload as { revoked_at?: string })?.revoked_at).toBe("string");
    expect(q?.filters).toEqual([
      { col: "id", val: "k-1", cmp: "eq" },
      { col: "user_id", val: "u-1", cmp: "eq" },
      { col: "revoked_at", val: null, cmp: "is" },
    ]);
  });

  it("returns false when no live row matched", async () => {
    const fake = makeSupabase({ updatedRows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await revokeApiKey(fake as any, "missing", "u-1");
    expect(ok).toBe(false);
  });
});

// ─── listApiKeysForUser ─────────────────────────────────────────────────────

describe("listApiKeysForUser", () => {
  it("strips key_hash from the returned shape", async () => {
    const fake = makeSupabase({
      selectRows: [
        {
          id: "k-1",
          user_id: "u-1",
          workspace_id: "ws-1",
          name: "CI",
          key_prefix: "wopr_aabbccd",
          key_hash: "should-not-leak",
          created_at: "2026-04-20T00:00:00Z",
          last_used_at: null,
          revoked_at: null,
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await listApiKeysForUser(fake as any, "u-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("key_hash");
    expect(rows[0]?.key_prefix).toBe("wopr_aabbccd");
  });
});

// ─── parseOperatorBearer ────────────────────────────────────────────────────

describe("parseOperatorBearer", () => {
  it("returns null for absent / wrong-scheme / wrong-prefix headers", () => {
    expect(parseOperatorBearer(null)).toBeNull();
    expect(parseOperatorBearer("")).toBeNull();
    expect(parseOperatorBearer("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseOperatorBearer("Bearer sk_live_abc")).toBeNull();
  });

  it("extracts a wopr_ token from a Bearer header (case-insensitive scheme)", () => {
    const raw = `${OPERATOR_API_KEY_PREFIX}${"d".repeat(32)}`;
    expect(parseOperatorBearer(`Bearer ${raw}`)).toBe(raw);
    expect(parseOperatorBearer(`bearer ${raw}`)).toBe(raw);
  });
});
