import { describe, it, expect } from "vitest";
import {
  checkRateLimit,
  registerBucketKey,
  tokenBucketKey,
  authorizeBucketKey,
  revokeBucketKey,
  REGISTRATION_LIMIT,
  TOKEN_LIMIT,
  AUTHORIZE_LIMIT,
  REVOKE_LIMIT,
} from "@/server/services/rate_limit_service";

/**
 * Pure-unit tests for the durable rate-limit service. We stub the
 * Supabase client with an in-memory map keyed on (bucket_key,
 * window_start) so the check-and-increment logic is observable
 * without a real database.
 */

interface Row {
  id: string;
  bucket_key: string;
  window_start: string;
  count: number;
}

function makeFakeSupabase() {
  const rows = new Map<string, Row>();
  const keyFor = (b: string, w: string) => `${b}|${w}`;

  const builder = (state: {
    filter: { bucket_key?: string; window_start?: string; id?: string };
  }) => {
    const b = {
      eq: (col: string, val: string) => {
        state.filter = { ...state.filter, [col]: val };
        return b;
      },
      maybeSingle: async () => {
        if (state.filter.id) {
          for (const r of rows.values()) {
            if (r.id === state.filter.id) return { data: r, error: null };
          }
          return { data: null, error: null };
        }
        const k = keyFor(state.filter.bucket_key!, state.filter.window_start!);
        return { data: rows.get(k) ?? null, error: null };
      },
    };
    return b;
  };

  const api = {
    from: (_table: string) => ({
      select: (_cols: string) => {
        const state = { filter: {} as { bucket_key?: string; window_start?: string; id?: string } };
        return builder(state);
      },
      insert: async (payload: { bucket_key: string; window_start: string; count: number }) => {
        const k = keyFor(payload.bucket_key, payload.window_start);
        if (rows.has(k)) {
          return { error: { message: "duplicate key value (23505)" } };
        }
        const row: Row = {
          id: `row-${rows.size + 1}`,
          bucket_key: payload.bucket_key,
          window_start: payload.window_start,
          count: payload.count,
        };
        rows.set(k, row);
        return { error: null };
      },
      update: (patch: { count: number }) => {
        const state = { filter: {} as { id?: string } };
        return {
          eq: (_col: string, val: string) => {
            state.filter.id = val;
            for (const r of rows.values()) {
              if (r.id === val) r.count = patch.count;
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    }),
  };

  return api as unknown as Parameters<typeof checkRateLimit>[0];
}

describe("rate_limit_service — bucket key helpers", () => {
  it("registration keys are per-user", () => {
    expect(registerBucketKey("u1")).toBe("oauth_register:user:u1");
  });
  it("token keys are per-client", () => {
    expect(tokenBucketKey("c1")).toBe("oauth_token:client:c1");
  });
  it("authorize keys are per-user", () => {
    expect(authorizeBucketKey("u1")).toBe("oauth_authorize:user:u1");
  });
  it("revoke keys are per-user", () => {
    expect(revokeBucketKey("u1")).toBe("oauth_revoke:user:u1");
  });
});

describe("rate_limit_service — pre-configured limits", () => {
  it("registration limit is 3 per hour", () => {
    expect(REGISTRATION_LIMIT.limit).toBe(3);
    expect(REGISTRATION_LIMIT.windowSeconds).toBe(3600);
  });
  it("token limit is 30 per minute", () => {
    expect(TOKEN_LIMIT.limit).toBe(30);
    expect(TOKEN_LIMIT.windowSeconds).toBe(60);
  });
  it("authorize limit is 10 per minute", () => {
    expect(AUTHORIZE_LIMIT.limit).toBe(10);
    expect(AUTHORIZE_LIMIT.windowSeconds).toBe(60);
  });
  it("revoke limit is 30 per minute", () => {
    expect(REVOKE_LIMIT.limit).toBe(30);
    expect(REVOKE_LIMIT.windowSeconds).toBe(60);
  });
});

describe("rate_limit_service — checkRateLimit", () => {
  it("allows calls under the limit and decrements remaining", async () => {
    const sb = makeFakeSupabase();
    const opts = { limit: 3, windowSeconds: 60 };
    const r1 = await checkRateLimit(sb, "test:a", opts);
    const r2 = await checkRateLimit(sb, "test:a", opts);
    const r3 = await checkRateLimit(sb, "test:a", opts);

    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("rejects the call that would exceed the limit", async () => {
    const sb = makeFakeSupabase();
    const opts = { limit: 2, windowSeconds: 60 };
    await checkRateLimit(sb, "test:b", opts);
    await checkRateLimit(sb, "test:b", opts);
    const denied = await checkRateLimit(sb, "test:b", opts);

    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.bucketKey).toBe("test:b");
    expect(denied.limit).toBe(2);
  });

  it("buckets distinct keys independently", async () => {
    const sb = makeFakeSupabase();
    const opts = { limit: 1, windowSeconds: 60 };
    const a = await checkRateLimit(sb, "keyA", opts);
    const b = await checkRateLimit(sb, "keyB", opts);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    // Second hit on A should be denied.
    const a2 = await checkRateLimit(sb, "keyA", opts);
    expect(a2.allowed).toBe(false);
  });
});
