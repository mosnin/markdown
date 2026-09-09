import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Unit tests for relay key management.
 *
 * A relay key is the credential that stands between a fresh install and a
 * working relay. The invariants worth pinning:
 *
 *   1. The raw secret is NEVER persisted — only a prefix and a sha256.
 *   2. A minted key round-trips: the hash stored is the hash the verification
 *      path will compute from the token we handed the user. This is the closest
 *      thing to an end-to-end proof available without a live database, and it
 *      is the failure that would be most embarrassing — handing someone a key
 *      that cannot possibly authenticate.
 *   3. Revocation kills the token AND the connection.
 *   4. Rotation revokes the old secret rather than leaving two live.
 *   5. Cross-workspace access is refused.
 *
 * Mocking strategy: a small in-memory table store behind a chainable builder,
 * so the tests exercise the real query shapes the service issues.
 */

import {
  createRelayKey,
  listRelayKeys,
  revokeRelayKey,
  rotateRelayKey,
  MAX_RELAY_KEYS_PER_WORKSPACE,
} from "@/server/services/relay_key_service";
import {
  looksLikeRelayToken,
  mintRelayToken,
  RELAY_TOKEN_PREFIX,
} from "@/server/auth/relay_auth";

const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-2222-2222-222222222222";
const ACTOR = "33333333-3333-3333-3333-333333333333";

interface Row {
  [key: string]: unknown;
}

/** In-memory stand-in for the two tables this service touches. */
class Store {
  connections: Row[] = [];
  connection_tokens: Row[] = [];
  private nextId = 1;

  id(): string {
    return `id-${this.nextId++}`;
  }
}

let store: Store;

function makeClient(): SupabaseClient {
  const client = {
    from(table: string) {
      const rows = () => (store as unknown as Record<string, Row[]>)[table];
      const filters: Array<(row: Row) => boolean> = [];
      let pendingInsert: Row | null = null;
      let pendingUpdate: Row | null = null;

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return builder;
        },
        neq: (column: string, value: unknown) => {
          filters.push((row) => row[column] !== value);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        insert: (payload: Row) => {
          pendingInsert = {
            id: store.id(),
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_used_at: null,
            usage_count: 0,
            ...payload,
          };
          rows().push(pendingInsert);
          return builder;
        },
        update: (payload: Row) => {
          pendingUpdate = payload;
          return builder;
        },
        maybeSingle: async () => {
          const matched = rows().filter((r) => filters.every((f) => f(r)));
          return { data: matched[0] ?? null, error: null };
        },
        single: async () => {
          if (pendingInsert) return { data: pendingInsert, error: null };
          if (pendingUpdate) {
            const matched = rows().filter((r) => filters.every((f) => f(r)));
            for (const row of matched) Object.assign(row, pendingUpdate);
            return { data: matched[0] ?? null, error: null };
          }
          const matched = rows().filter((r) => filters.every((f) => f(r)));
          return { data: matched[0] ?? null, error: null };
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          if (pendingUpdate) {
            const matched = rows().filter((r) => filters.every((f) => f(r)));
            for (const row of matched) Object.assign(row, pendingUpdate);
            return resolve({ data: matched, error: null });
          }
          const matched = rows().filter((r) => filters.every((f) => f(r)));
          return resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

beforeEach(() => {
  store = new Store();
});

describe("mintRelayToken", () => {
  it("produces a token the verification path will accept", () => {
    const minted = mintRelayToken();
    expect(looksLikeRelayToken(minted.token)).toBe(true);
    expect(minted.token.startsWith(RELAY_TOKEN_PREFIX)).toBe(true);
  });

  it("stores a prefix and hash that match the token handed out", () => {
    // This is the round trip that matters: if these drift, every key we mint
    // is dead on arrival and nobody finds out until a hook silently 401s.
    const minted = mintRelayToken();
    const hex = minted.token.slice(RELAY_TOKEN_PREFIX.length);

    expect(minted.token_prefix).toBe(hex.slice(0, 8));
    expect(minted.secret_hash).toBe(
      createHash("sha256").update(hex).digest("hex")
    );
  });

  it("is unique across calls", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => mintRelayToken().token)
    );
    expect(tokens.size).toBe(50);
  });

  it("rejects tokens of the wrong shape", () => {
    expect(looksLikeRelayToken("pgr_v1_short")).toBe(false);
    expect(looksLikeRelayToken(`csk_v1_${"a".repeat(64)}`)).toBe(false);
    // Uppercase hex is not the format we mint, so it is not accepted.
    expect(looksLikeRelayToken(`pgr_v1_${"A".repeat(64)}`)).toBe(false);
  });
});

describe("createRelayKey", () => {
  it("returns the raw token but never persists it", async () => {
    const client = makeClient();
    const result = await createRelayKey(client, WORKSPACE, ACTOR, {
      name: "work-laptop",
    });

    expect(looksLikeRelayToken(result.token)).toBe(true);

    // The secret must appear nowhere in what was written.
    const persisted = JSON.stringify({
      connections: store.connections,
      tokens: store.connection_tokens,
    });
    const hex = result.token.slice(RELAY_TOKEN_PREFIX.length);
    expect(persisted).not.toContain(hex);
    expect(persisted).not.toContain(result.token);

    // What IS stored is the prefix and the hash.
    const token = store.connection_tokens[0];
    expect(token.token_prefix).toBe(hex.slice(0, 8));
    expect(token.secret_hash).toBe(
      createHash("sha256").update(hex).digest("hex")
    );
  });

  it("creates an agent_hook connection that can write", async () => {
    const client = makeClient();
    await createRelayKey(client, WORKSPACE, ACTOR, { name: "ci-runner" });

    const connection = store.connections[0];
    expect(connection.connection_type).toBe("agent_hook");
    expect(connection.workspace_id).toBe(WORKSPACE);
    // The relay auth path reads anything other than read_only as "may append".
    expect(connection.permission_mode).not.toBe("read_only");
  });

  it("defaults to no expiry", async () => {
    // Deliberate: a hook key that expires mid-session fails silently, as an
    // empty brief weeks later with no obvious cause.
    const client = makeClient();
    await createRelayKey(client, WORKSPACE, ACTOR, { name: "laptop" });
    expect(store.connection_tokens[0].expires_at).toBeNull();
  });

  it("honours an explicit expiry when one is asked for", async () => {
    const client = makeClient();
    const expiresAt = "2027-01-01T00:00:00.000Z";
    await createRelayKey(client, WORKSPACE, ACTOR, {
      name: "contractor",
      expiresAt,
    });
    expect(store.connection_tokens[0].expires_at).toBe(expiresAt);
  });

  it("requires a name so keys can be told apart", async () => {
    const client = makeClient();
    await expect(
      createRelayKey(client, WORKSPACE, ACTOR, { name: "   " })
    ).rejects.toThrow(/name is required/i);
  });

  it("enforces the per-workspace ceiling", async () => {
    const client = makeClient();
    for (let i = 0; i < MAX_RELAY_KEYS_PER_WORKSPACE; i += 1) {
      await createRelayKey(client, WORKSPACE, ACTOR, { name: `key-${i}` });
    }
    await expect(
      createRelayKey(client, WORKSPACE, ACTOR, { name: "one too many" })
    ).rejects.toThrow(/limit/i);
  });
});

describe("listRelayKeys", () => {
  it("exposes the prefix but never the secret", async () => {
    const client = makeClient();
    await createRelayKey(client, WORKSPACE, ACTOR, { name: "laptop" });

    const keys = await listRelayKeys(client, WORKSPACE);
    expect(keys).toHaveLength(1);
    expect(keys[0].token_prefix).toHaveLength(8);
    expect(JSON.stringify(keys)).not.toContain("secret_hash");
  });

  it("does not leak another workspace's keys", async () => {
    const client = makeClient();
    await createRelayKey(client, WORKSPACE, ACTOR, { name: "ours" });
    await createRelayKey(client, OTHER_WORKSPACE, ACTOR, { name: "theirs" });

    const keys = await listRelayKeys(client, WORKSPACE);
    expect(keys.map((k) => k.name)).toEqual(["ours"]);
  });
});

describe("revokeRelayKey", () => {
  it("revokes the token and the connection together", async () => {
    const client = makeClient();
    const created = await createRelayKey(client, WORKSPACE, ACTOR, {
      name: "retired-laptop",
    });

    await revokeRelayKey(client, WORKSPACE, created.key.connection_id, ACTOR);

    expect(store.connections[0].status).toBe("revoked");
    expect(store.connection_tokens[0].status).toBe("revoked");
    expect(store.connection_tokens[0].revoked_at).toBeTruthy();
  });

  it("refuses a key belonging to another workspace", async () => {
    const client = makeClient();
    const created = await createRelayKey(client, OTHER_WORKSPACE, ACTOR, {
      name: "theirs",
    });

    await expect(
      revokeRelayKey(client, WORKSPACE, created.key.connection_id, ACTOR)
    ).rejects.toThrow(/not found/i);
    // And it stays live.
    expect(store.connections[0].status).toBe("active");
  });
});

describe("rotateRelayKey", () => {
  it("issues a new secret and revokes the old one", async () => {
    const client = makeClient();
    const created = await createRelayKey(client, WORKSPACE, ACTOR, {
      name: "laptop",
    });
    const originalPrefix = created.key.token_prefix;

    const rotated = await rotateRelayKey(
      client,
      WORKSPACE,
      created.key.connection_id,
      ACTOR
    );

    expect(looksLikeRelayToken(rotated.token)).toBe(true);
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.token_prefix).not.toBe(originalPrefix);

    // Exactly one live token — an unattended shim cannot migrate gracefully,
    // so an overlap window would just mean two working secrets.
    const active = store.connection_tokens.filter((t) => t.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].token_prefix).toBe(rotated.token_prefix);

    // The connection itself survives, so the key keeps its name and history.
    expect(store.connections[0].status).toBe("active");
  });

  it("refuses to rotate a revoked key", async () => {
    const client = makeClient();
    const created = await createRelayKey(client, WORKSPACE, ACTOR, {
      name: "laptop",
    });
    await revokeRelayKey(client, WORKSPACE, created.key.connection_id, ACTOR);

    await expect(
      rotateRelayKey(client, WORKSPACE, created.key.connection_id, ACTOR)
    ).rejects.toThrow(/revoked/i);
  });
});
