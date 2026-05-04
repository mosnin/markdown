import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  issuePullToken,
  listPullTokensForUser,
  revokePullToken,
  redeemPullToken,
  hashPullToken,
  PULL_TOKEN_PREFIX,
} from "@/server/services/pull_token_service";

/**
 * Pull-token service — happy paths.
 *
 * Issue / list / revoke ride a fake Supabase client; redeem dispatches
 * to the `redeem_pull_token` RPC and we mock the response shape.
 */

interface FakeRow {
  [key: string]: unknown;
}

function makeFakeSupabase(initial: { pull_tokens?: FakeRow[] } = {}) {
  const tables: Record<string, FakeRow[]> = {
    pull_tokens: initial.pull_tokens ?? [],
  };

  let rpcImpl: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }> = async () => ({
    data: [],
    error: null,
  });

  function buildQuery(tableName: string) {
    let rows = [...(tables[tableName] ?? [])];
    const filters: Array<(r: FakeRow) => boolean> = [];
    let ordering: { col: string; asc: boolean } | null = null;
    let pendingInsert: FakeRow | null = null;
    let pendingUpdate: FakeRow | null = null;

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return chain;
      },
      gt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) > (val as string));
        return chain;
      },
      is: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return chain;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => (vals as unknown[]).includes(r[col]));
        return chain;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        ordering = { col, asc: opts?.ascending ?? true };
        return chain;
      },
      insert: (row: FakeRow) => {
        pendingInsert = { ...row };
        return chain;
      },
      update: (patch: FakeRow) => {
        pendingUpdate = patch;
        return chain;
      },
      single: async () => {
        if (pendingInsert) {
          const inserted = {
            id: "tok-" + ((tables[tableName]?.length ?? 0) + 1),
            redemption_count: 0,
            last_redeemed_at: null,
            last_user_agent: null,
            revoked_at: null,
            created_at: new Date().toISOString(),
            ...pendingInsert,
          };
          tables[tableName]!.push(inserted);
          return { data: inserted, error: null };
        }
        let result = [...(tables[tableName] ?? [])];
        for (const f of filters) result = result.filter(f);
        return { data: result[0] ?? null, error: null };
      },
      maybeSingle: async () => {
        let result = [...(tables[tableName] ?? [])];
        for (const f of filters) result = result.filter(f);
        return { data: result[0] ?? null, error: null };
      },
      then: async (resolve: (val: unknown) => void) => {
        let result = pendingInsert ? [pendingInsert] : rows;
        for (const f of filters) result = result.filter(f);
        if (pendingUpdate) {
          for (const r of result) Object.assign(r, pendingUpdate);
        }
        if (ordering) {
          const { col, asc } = ordering;
          result.sort((a, b) => {
            if ((a[col] as string) < (b[col] as string)) return asc ? -1 : 1;
            if ((a[col] as string) > (b[col] as string)) return asc ? 1 : -1;
            return 0;
          });
        }
        resolve({ data: result, error: null });
      },
    };

    return chain;
  }

  return {
    from: (tableName: string) => buildQuery(tableName),
    rpc: (name: string, args: Record<string, unknown>) => rpcImpl(name, args),
    _tables: tables,
    _setRpc: (impl: typeof rpcImpl) => {
      rpcImpl = impl;
    },
  } as unknown as {
    from: (n: string) => ReturnType<typeof buildQuery>;
    rpc: typeof rpcImpl;
    _tables: typeof tables;
    _setRpc: (impl: typeof rpcImpl) => void;
  };
}

describe("pull_token_service", () => {
  const workspaceId = "ws-1";
  const userId = "user-1";
  const noteId = "note-1";

  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("issuePullToken", () => {
    it("returns a raw token starting with the public prefix", async () => {
      const supabase = makeFakeSupabase();
      const { token, summary } = await issuePullToken(supabase as never, {
        workspaceId,
        userId,
        objectType: "note",
        objectId: noteId,
        ttlSeconds: 600,
        writeCapable: false,
      });
      expect(token.startsWith(PULL_TOKEN_PREFIX)).toBe(true);
      expect(summary.tokenPrefix.length).toBe(16);
      expect(summary.objectType).toBe("note");
      expect(summary.writeCapable).toBe(false);
      expect(summary.maxRedemptions).toBe(100);
    });

    it("clamps ttl below 60s up to 60s and above 86400s down", async () => {
      const supabase = makeFakeSupabase();
      const a = await issuePullToken(supabase as never, {
        workspaceId,
        userId,
        objectType: "note",
        objectId: noteId,
        ttlSeconds: 30,
        writeCapable: true,
      });
      const aDuration = (Date.parse(a.summary.expiresAt) - Date.parse(a.summary.createdAt)) / 1000;
      expect(aDuration).toBeGreaterThanOrEqual(59);
      expect(aDuration).toBeLessThanOrEqual(61);

      const b = await issuePullToken(supabase as never, {
        workspaceId,
        userId,
        objectType: "note",
        objectId: noteId,
        ttlSeconds: 999_999,
        writeCapable: true,
      });
      const bDuration = (Date.parse(b.summary.expiresAt) - Date.parse(b.summary.createdAt)) / 1000;
      expect(bDuration).toBeLessThanOrEqual(86_401);
      expect(bDuration).toBeGreaterThanOrEqual(86_399);
    });

    it("stores a sha256 hash, not the raw token", async () => {
      const supabase = makeFakeSupabase();
      const { token } = await issuePullToken(supabase as never, {
        workspaceId,
        userId,
        objectType: "note",
        objectId: noteId,
        ttlSeconds: 120,
        writeCapable: false,
      });
      const stored = supabase._tables.pull_tokens[0]!;
      expect(stored.token_hash).toBe(hashPullToken(token));
      expect(stored.token_hash).not.toBe(token);
    });

    it("rejects unknown object types", async () => {
      const supabase = makeFakeSupabase();
      await expect(
        issuePullToken(supabase as never, {
          workspaceId,
          userId,
          // @ts-expect-error invalid type for the test
          objectType: "weird",
          objectId: noteId,
          ttlSeconds: 600,
          writeCapable: false,
        })
      ).rejects.toThrow(/Invalid pull-token object_type/);
    });
  });

  describe("listPullTokensForUser", () => {
    it("returns rows for the matching workspace + user", async () => {
      const now = new Date().toISOString();
      const supabase = makeFakeSupabase({
        pull_tokens: [
          {
            id: "t-1",
            workspace_id: workspaceId,
            user_id: userId,
            token_prefix: "pgl_pull_AAAA__",
            object_type: "note",
            object_id: noteId,
            write_capable: false,
            expires_at: now,
            hard_cap_at: now,
            sliding_window_seconds: 0,
            max_redemptions: 100,
            redemption_count: 0,
            last_redeemed_at: null,
            last_user_agent: null,
            revoked_at: null,
            created_at: now,
          },
          {
            id: "t-2",
            workspace_id: "other-ws",
            user_id: userId,
            token_prefix: "pgl_pull_BBBB__",
            object_type: "note",
            object_id: noteId,
            write_capable: true,
            expires_at: now,
            hard_cap_at: now,
            sliding_window_seconds: 0,
            max_redemptions: 100,
            redemption_count: 0,
            last_redeemed_at: null,
            last_user_agent: null,
            revoked_at: null,
            created_at: now,
          },
        ],
      });
      const summaries = await listPullTokensForUser(
        supabase as never,
        workspaceId,
        userId
      );
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe("t-1");
    });
  });

  describe("revokePullToken", () => {
    it("stamps revoked_at on the matching row", async () => {
      const now = new Date().toISOString();
      const supabase = makeFakeSupabase({
        pull_tokens: [
          {
            id: "t-1",
            workspace_id: workspaceId,
            user_id: userId,
            revoked_at: null,
            created_at: now,
          },
        ],
      });
      await revokePullToken(supabase as never, "t-1", userId);
      expect(supabase._tables.pull_tokens[0].revoked_at).not.toBeNull();
    });
  });

  describe("redeemPullToken", () => {
    it("returns null when token is not prefixed correctly", async () => {
      const supabase = makeFakeSupabase();
      const r = await redeemPullToken(supabase as never, "garbage", null);
      expect(r).toBeNull();
    });

    it("maps RPC rows into a RedeemResult", async () => {
      const supabase = makeFakeSupabase();
      const futureExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
      supabase._setRpc(async () => ({
        data: [
          {
            workspace_id: workspaceId,
            user_id: userId,
            object_type: "note",
            object_id: noteId,
            write_capable: true,
            new_expires_at: futureExpiry,
          },
        ],
        error: null,
      }));
      const result = await redeemPullToken(
        supabase as never,
        `${PULL_TOKEN_PREFIX}AAAA`,
        "agent/1.0"
      );
      expect(result).not.toBeNull();
      expect(result!.workspaceId).toBe(workspaceId);
      expect(result!.objectId).toBe(noteId);
      expect(result!.writeCapable).toBe(true);
      expect(result!.expiresInSeconds).toBeGreaterThan(0);
    });

    it("returns null when the RPC produces no rows", async () => {
      const supabase = makeFakeSupabase();
      supabase._setRpc(async () => ({ data: [], error: null }));
      const result = await redeemPullToken(
        supabase as never,
        `${PULL_TOKEN_PREFIX}AAAA`,
        null
      );
      expect(result).toBeNull();
    });
  });
});
