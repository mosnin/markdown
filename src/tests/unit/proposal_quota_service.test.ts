import { describe, it, expect } from "vitest";

import {
  checkProposalQuota,
  checkConnectedAgentQuota,
  isQuotaExceeded,
  quotaExceeded,
} from "@/server/services/proposal_quota_service";
import {
  PROPOSAL_TIER_LIMITS,
  CONNECTED_AGENT_TIER_LIMITS,
} from "@/server/domain/constants/proposal_quota";

/**
 * Unit tests for `proposal_quota_service` — the counting + tier resolution
 * behind the write-proposal paywall.
 *
 * A tiny Supabase double is hand-rolled per case. `.from(table)` dispatches
 * to a builder so a single mock can answer both the `workspace_subscriptions`
 * read (plan + period) and the `write_proposals` / `connections` count.
 */

const WORKSPACE_ID = "ws-001";

interface MockTableSpec {
  /** Row returned by `.maybeSingle()` (subscription read). */
  row?: Record<string, unknown> | null;
  /** Count returned by a `{ count: "exact", head: true }` select. */
  count?: number | null;
  /** Error returned by the terminal call (drives fail-closed paths). */
  error?: { message?: string; code?: string } | null;
}

/**
 * Build a Supabase-like client. Each select chain is thenable on the leaf
 * calls the service uses: `.maybeSingle()` for the subscription read and the
 * count query resolves on the final `.gte()` / `.neq()` call.
 */
function makeClient(tables: Record<string, MockTableSpec>) {
  return {
    from(table: string) {
      const spec = tables[table] ?? {};
      const countResult = { count: spec.count ?? 0, error: spec.error ?? null };

      // The count query shape used by checkProposalQuota:
      //   .select(.., {count, head}).eq(workspace_id).gte(created_at)
      // and by checkConnectedAgentQuota:
      //   .select(.., {count, head}).eq(workspace_id).neq(status)
      const countChain = {
        eq: () => ({
          gte: () => Promise.resolve(countResult),
          neq: () => Promise.resolve(countResult),
        }),
      };

      // The subscription read shape:
      //   .select(..).eq(workspace_id).maybeSingle()
      const readChain = {
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: spec.row ?? null, error: spec.error ?? null }),
        }),
      };

      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) =>
          opts?.head ? countChain : readChain,
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ─── helpers ────────────────────────────────────────────────────────────────

describe("isQuotaExceeded / quotaExceeded", () => {
  it("builds a typed over-limit payload", () => {
    const payload = quotaExceeded({
      tier: "free",
      limit: 20,
      used: 20,
      allowed: false,
      resetsAt: new Date(),
    });
    expect(payload).toEqual({
      ok: false,
      code: "quota_exceeded",
      limit: 20,
      used: 20,
      upgradeUrl: "/pricing",
    });
    expect(isQuotaExceeded(payload)).toBe(true);
  });

  it("rejects non-matching values", () => {
    expect(isQuotaExceeded(null)).toBe(false);
    expect(isQuotaExceeded({ id: "proposal-1" })).toBe(false);
    expect(isQuotaExceeded({ ok: true })).toBe(false);
  });
});

// ─── checkProposalQuota ───────────────────────────────────────────────────────

describe("checkProposalQuota", () => {
  it("free tier under limit → allowed", async () => {
    const client = makeClient({
      workspace_subscriptions: { row: null },
      write_proposals: { count: 5 },
    });
    const q = await checkProposalQuota(client, WORKSPACE_ID);
    expect(q.tier).toBe("free");
    expect(q.limit).toBe(PROPOSAL_TIER_LIMITS.free);
    expect(q.used).toBe(5);
    expect(q.allowed).toBe(true);
  });

  it("free tier at limit → not allowed", async () => {
    const client = makeClient({
      workspace_subscriptions: { row: null },
      write_proposals: { count: PROPOSAL_TIER_LIMITS.free },
    });
    const q = await checkProposalQuota(client, WORKSPACE_ID);
    expect(q.allowed).toBe(false);
    expect(q.used).toBe(PROPOSAL_TIER_LIMITS.free);
  });

  it("active pro subscription uses the pro limit", async () => {
    const client = makeClient({
      workspace_subscriptions: {
        row: { plan: "pro", status: "active", current_period_end: null },
      },
      write_proposals: { count: PROPOSAL_TIER_LIMITS.free + 1 },
    });
    const q = await checkProposalQuota(client, WORKSPACE_ID);
    expect(q.tier).toBe("pro");
    expect(q.limit).toBe(PROPOSAL_TIER_LIMITS.pro);
    // Above the free cap but well under pro → still allowed.
    expect(q.allowed).toBe(true);
  });

  it("cancelled pro subscription falls back to free", async () => {
    const client = makeClient({
      workspace_subscriptions: {
        row: { plan: "pro", status: "cancelled", current_period_end: null },
      },
      write_proposals: { count: 0 },
    });
    const q = await checkProposalQuota(client, WORKSPACE_ID);
    expect(q.tier).toBe("free");
    expect(q.limit).toBe(PROPOSAL_TIER_LIMITS.free);
  });

  it("fails CLOSED when the usage count errors", async () => {
    const client = makeClient({
      workspace_subscriptions: { row: null },
      write_proposals: { error: { message: "boom" } },
    });
    const q = await checkProposalQuota(client, WORKSPACE_ID);
    expect(q.allowed).toBe(false);
    // Used is pinned to the limit so callers see a "full" bucket.
    expect(q.used).toBe(q.limit);
  });
});

// ─── checkConnectedAgentQuota ─────────────────────────────────────────────────

describe("checkConnectedAgentQuota", () => {
  it("free tier allows the first connection, blocks the second", async () => {
    const atZero = makeClient({
      workspace_subscriptions: { row: null },
      connections: { count: 0 },
    });
    expect((await checkConnectedAgentQuota(atZero, WORKSPACE_ID)).allowed).toBe(true);

    const atCap = makeClient({
      workspace_subscriptions: { row: null },
      connections: { count: CONNECTED_AGENT_TIER_LIMITS.free },
    });
    expect((await checkConnectedAgentQuota(atCap, WORKSPACE_ID)).allowed).toBe(false);
  });
});
