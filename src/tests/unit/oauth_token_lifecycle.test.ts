import { describe, it, expect, beforeEach } from "vitest";
import {
  issueTokenPair,
  refreshTokenPair,
  resolveAccessToken,
  revokeAllTokensForConsent,
  parseBearerAccessToken,
} from "@/server/services/oauth_token_service";

/**
 * Unit tests for the OAuth token lifecycle invariants:
 *
 *   - Refresh rotation: old refresh marked used_at; new pair shares family.
 *   - Replay rejection: reusing a rotated refresh kills the entire family.
 *   - Revoked consent cascades: resolveAccessToken refuses tokens under a
 *     revoked consent even if the access token itself is live.
 *   - first_used_at populates exactly once on first successful resolve.
 *
 * We stub Supabase with an in-memory table store. The stub covers the
 * narrow surface oauth_token_service uses (insert, update, select,
 * maybeSingle, single, eq/in/is filters) — enough for the lifecycle
 * paths without pulling in a real database.
 */

type Row = Record<string, unknown> & { id: string };

function makeDb() {
  const tables: Record<string, Map<string, Row>> = {
    oauth_access_tokens: new Map(),
    oauth_refresh_tokens: new Map(),
    oauth_consents: new Map(),
    oauth_authorization_codes: new Map(),
  };

  let idSeed = 0;
  const nextId = () => `id-${++idSeed}`;

  function builder(table: string) {
    const state: {
      op: "select" | "update" | "insert";
      filters: Array<(r: Row) => boolean>;
      updates?: Record<string, unknown>;
      selectCols?: string;
    } = { op: "select", filters: [] };

    const api = {
      select: (cols?: string) => {
        state.selectCols = cols;
        return api;
      },
      insert: (payload: Record<string, unknown>) => {
        const row: Row = { id: nextId(), ...payload };
        tables[table].set(row.id, row);
        return {
          select: (_c?: string) => ({
            single: async () => ({ data: row, error: null }),
          }),
          then: (cb: (v: { error: null }) => unknown) => cb({ error: null }),
          // allow `await insert(...)` with no .select()
          [Symbol.asyncIterator]: undefined,
        };
      },
      update: (patch: Record<string, unknown>) => {
        state.op = "update";
        state.updates = patch;
        return api;
      },
      eq: (col: string, val: unknown) => {
        state.filters.push((r) => r[col] === val);
        return api;
      },
      in: (col: string, vals: unknown[]) => {
        state.filters.push((r) => vals.includes(r[col]));
        return api;
      },
      is: (col: string, val: null) => {
        state.filters.push((r) => r[col] === val || r[col] === undefined);
        return api;
      },
      neq: (col: string, val: unknown) => {
        state.filters.push((r) => r[col] !== val);
        return api;
      },
      maybeSingle: async () => {
        const matches = Array.from(tables[table].values()).filter((r) =>
          state.filters.every((f) => f(r))
        );
        if (state.op === "update" && state.updates && matches.length) {
          Object.assign(matches[0], state.updates);
          return { data: matches[0], error: null };
        }
        return { data: matches[0] ?? null, error: null };
      },
      single: async () => {
        const matches = Array.from(tables[table].values()).filter((r) =>
          state.filters.every((f) => f(r))
        );
        if (state.op === "update" && state.updates && matches.length) {
          Object.assign(matches[0], state.updates);
        }
        return { data: matches[0] ?? null, error: matches[0] ? null : { message: "not found" } };
      },
      then: (cb: (v: { data: Row[]; error: null }) => unknown) => {
        const matches = Array.from(tables[table].values()).filter((r) =>
          state.filters.every((f) => f(r))
        );
        if (state.op === "update" && state.updates) {
          for (const r of matches) Object.assign(r, state.updates);
        }
        return cb({ data: matches, error: null });
      },
    };
    return api;
  }

  const sb = {
    from: (table: string) => builder(table),
  } as unknown as Parameters<typeof issueTokenPair>[0];

  return { sb, tables };
}

const CLIENT = "client-x";
const USER = "00000000-0000-0000-0000-00000000aaaa";
const WS = "00000000-0000-0000-0000-00000000bbbb";

describe("oauth_token_service — refresh rotation", () => {
  let env: ReturnType<typeof makeDb>;
  beforeEach(() => {
    env = makeDb();
  });

  it("issues a pair, then rotates: old refresh is used, family unchanged", async () => {
    const pair = await issueTokenPair(env.sb, {
      clientId: CLIENT,
      userId: USER,
      workspaceId: WS,
      scope: ["context:read"],
    });
    expect(pair.accessToken.startsWith("cso_a_")).toBe(true);
    expect(pair.refreshToken.startsWith("cso_r_")).toBe(true);
    expect(pair.accessTokenId).toBeTruthy();
    expect(pair.refreshTokenId).toBeTruthy();
    expect(pair.rotatedFromRefreshTokenId).toBeNull();

    const refreshed = await refreshTokenPair(env.sb, {
      refreshToken: pair.refreshToken,
      clientId: CLIENT,
    });
    expect("ok" in refreshed && refreshed.ok === false).toBe(false);

    // Old refresh row must be marked used.
    const oldRefresh = Array.from(env.tables.oauth_refresh_tokens.values()).find(
      (r) => r.id === pair.refreshTokenId
    );
    expect(oldRefresh?.used_at).toBeTruthy();

    // Family_id of new refresh equals the old one.
    const newRefresh = Array.from(env.tables.oauth_refresh_tokens.values()).find(
      (r) => r.id !== pair.refreshTokenId
    );
    expect(newRefresh?.family_id).toBe(oldRefresh?.family_id);

    if ("ok" in refreshed === false) {
      const rotatedPair = refreshed as typeof pair;
      expect(rotatedPair.rotatedFromRefreshTokenId).toBe(pair.refreshTokenId);
    }
  });

  it("replaying a rotated refresh token nukes the whole family", async () => {
    const pair = await issueTokenPair(env.sb, {
      clientId: CLIENT,
      userId: USER,
      workspaceId: WS,
      scope: ["context:read"],
    });
    await refreshTokenPair(env.sb, {
      refreshToken: pair.refreshToken,
      clientId: CLIENT,
    });
    const replay = await refreshTokenPair(env.sb, {
      refreshToken: pair.refreshToken,
      clientId: CLIENT,
    });
    expect("ok" in replay && replay.ok === false).toBe(true);

    // Every refresh in the family must now be revoked.
    const family = Array.from(env.tables.oauth_refresh_tokens.values());
    expect(family.length).toBeGreaterThan(0);
    for (const r of family) {
      // either used_at or revoked_at must be set
      expect(r.used_at || r.revoked_at).toBeTruthy();
    }
  });
});

describe("oauth_token_service — revocation paths", () => {
  let env: ReturnType<typeof makeDb>;
  beforeEach(() => {
    env = makeDb();
  });

  it("revokeAllTokensForConsent cascades to access + refresh and stamps consent", async () => {
    // Seed a consent row.
    const consentId = "consent-1";
    env.tables.oauth_consents.set(consentId, {
      id: consentId,
      user_id: USER,
      client_id: CLIENT,
      workspace_id: WS,
      revoked_at: null,
    });

    const pair = await issueTokenPair(env.sb, {
      clientId: CLIENT,
      userId: USER,
      workspaceId: WS,
      scope: ["context:read"],
    });

    await revokeAllTokensForConsent(env.sb, consentId);

    const accessRow = env.tables.oauth_access_tokens.get(pair.accessTokenId);
    const refreshRow = env.tables.oauth_refresh_tokens.get(pair.refreshTokenId);
    expect(accessRow?.revoked_at).toBeTruthy();
    expect(refreshRow?.revoked_at).toBeTruthy();
    // Consent itself is stamped.
    expect(env.tables.oauth_consents.get(consentId)?.revoked_at).toBeTruthy();
  });

  it("resolveAccessToken refuses a token whose consent is revoked", async () => {
    const consentId = "consent-2";
    env.tables.oauth_consents.set(consentId, {
      id: consentId,
      user_id: USER,
      client_id: CLIENT,
      workspace_id: WS,
      revoked_at: null,
    });

    const pair = await issueTokenPair(env.sb, {
      clientId: CLIENT,
      userId: USER,
      workspaceId: WS,
      scope: ["context:read"],
    });

    // Mark consent revoked.
    env.tables.oauth_consents.get(consentId)!.revoked_at = new Date().toISOString();

    const parsed = parseBearerAccessToken(`Bearer ${pair.accessToken}`);
    const resolved = await resolveAccessToken(env.sb, parsed!);
    expect(resolved).toBeNull();
  });
});

describe("oauth_token_service — first_used_at", () => {
  let env: ReturnType<typeof makeDb>;
  beforeEach(() => {
    env = makeDb();
  });

  it("populates first_used_at exactly once on the first successful resolve", async () => {
    env.tables.oauth_consents.set("consent-3", {
      id: "consent-3",
      user_id: USER,
      client_id: CLIENT,
      workspace_id: WS,
      revoked_at: null,
    });

    const pair = await issueTokenPair(env.sb, {
      clientId: CLIENT,
      userId: USER,
      workspaceId: WS,
      scope: ["context:read"],
    });

    const parsed = parseBearerAccessToken(`Bearer ${pair.accessToken}`);
    const first = await resolveAccessToken(env.sb, parsed!);
    expect(first).not.toBeNull();

    const row = env.tables.oauth_access_tokens.get(pair.accessTokenId)!;
    const firstUsedAt = row.first_used_at as string | null | undefined;
    expect(firstUsedAt).toBeTruthy();

    // A second resolve must not shift first_used_at forwards in time.
    await new Promise((r) => setTimeout(r, 5));
    await resolveAccessToken(env.sb, parsed!);
    expect(row.first_used_at).toBe(firstUsedAt);
  });
});
