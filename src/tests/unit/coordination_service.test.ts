import { describe, it, expect, beforeEach } from "vitest";
import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Unit tests for multi-agent coordination.
 *
 * The invariants that matter here are about what an agent is TOLD, because
 * claims are advisory — we cannot intercept another agent's edit tool, so the
 * entire value of this layer is the warning arriving in time:
 *
 *   1. An agent never sees its own events or notices as "news".
 *   2. When someone edits a file I claimed, I am told, with who and what.
 *   3. When I ask for something someone holds, I am told who holds it and why
 *      — not handed an error.
 *   4. Directory claims match their contents, and nothing else. A false
 *      conflict is worse than a missed one: an agent warned about collisions
 *      it does not have learns to ignore collision warnings.
 *   5. Unanswered questions surface regardless of the delta cursor, so a
 *      question cannot scroll away unanswered.
 *   6. The cursor advances only after the delta is assembled.
 */

import {
  checkIn,
  resourceOverlaps,
  DEFAULT_CLAIM_TTL_SECONDS,
  SUGGESTED_CHECKIN_SECONDS,
} from "@/server/services/coordination_service";

const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const PEER = "44444444-4444-4444-4444-444444444444";

interface Tables {
  agent_sessions: Record<string, unknown>[];
  session_events: Record<string, unknown>[];
  project_claims: Record<string, unknown>[];
  project_notices: Record<string, unknown>[];
}

let tables: Tables;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: ME,
    workspace_id: WORKSPACE,
    project_id: PROJECT,
    external_id: "cc-me",
    agent_tool: "claude_code",
    agent_model: "claude-opus-5",
    account_label: "plan-a",
    status: "active",
    end_reason: null,
    git_branch: "feat/charges",
    current_intent: null,
    last_checkin_at: "2026-09-09T10:00:00.000Z",
    checkin_count: 3,
    started_at: "2026-09-09T09:00:00.000Z",
    last_seen_at: "2026-09-09T10:00:00.000Z",
    event_count: 10,
    ...overrides,
  };
}

/**
 * Chainable stub over the in-memory tables. Filters are applied for the
 * predicates the service actually uses, so the tests exercise real call shapes.
 */
function makeClient(): SupabaseClient {
  const client = {
    from(table: string) {
      let rows = [...((tables as unknown as Record<string, Record<string, unknown>[]>)[table] ?? [])];
      let update: Record<string, unknown> | null = null;
      let insert: Record<string, unknown> | null = null;

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        neq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] !== val);
          return builder;
        },
        gt: (col: string, val: unknown) => {
          rows = rows.filter((r) => String(r[col]) > String(val));
          return builder;
        },
        gte: (col: string, val: unknown) => {
          rows = rows.filter((r) => Number(r[col]) >= Number(val));
          return builder;
        },
        lt: () => builder,
        is: (col: string, val: unknown) => {
          rows = rows.filter((r) => (r[col] ?? null) === val);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        update: (payload: Record<string, unknown>) => {
          update = payload;
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          insert = { id: `n-${Math.random()}`, created_at: new Date().toISOString(), ...payload };
          (tables as unknown as Record<string, Record<string, unknown>[]>)[table].push(insert);
          return builder;
        },
        single: async () => {
          if (insert) return { data: insert, error: null };
          if (update) {
            for (const row of rows) Object.assign(row, update);
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows[0] ?? null, error: null };
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
          if (update) for (const row of rows) Object.assign(row, update);
          return resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "claim_resources") {
        // Mirror the SQL: grant unless another live claim holds the resource.
        const requested = args.p_resources as Array<Record<string, unknown>>;
        const out = requested.map((req) => {
          const held = tables.project_claims.find(
            (c) => c.resource === req.resource && c.released_at === null
          );
          if (held && held.session_id !== args.p_session_id) {
            return {
              resource: req.resource,
              granted: false,
              held_by: held.session_id,
              held_intent: held.intent,
              expires_at: held.expires_at,
            };
          }
          const expires = new Date(Date.now() + 900_000).toISOString();
          if (!held) {
            tables.project_claims.push({
              session_id: args.p_session_id,
              project_id: PROJECT,
              resource: req.resource,
              intent: req.intent ?? null,
              released_at: null,
              expires_at: expires,
            });
          }
          return {
            resource: req.resource,
            granted: true,
            held_by: args.p_session_id,
            held_intent: req.intent ?? null,
            expires_at: expires,
          };
        });
        return { data: out, error: null };
      }
      if (fn === "release_claims") {
        const list = args.p_resources as string[] | null;
        let n = 0;
        for (const claim of tables.project_claims) {
          if (claim.session_id !== args.p_session_id || claim.released_at !== null) continue;
          if (list && !list.includes(claim.resource as string)) continue;
          claim.released_at = new Date().toISOString();
          n += 1;
        }
        return { data: n, error: null };
      }
      return { data: null, error: null };
    },
  };
  return client as unknown as SupabaseClient;
}

beforeEach(() => {
  rpcCalls = [];
  tables = {
    agent_sessions: [session()],
    session_events: [],
    project_claims: [],
    project_notices: [],
  };
});

describe("resourceOverlaps", () => {
  it("matches a file against itself", () => {
    expect(resourceOverlaps("src/a.ts", "src/a.ts")).toBe(true);
  });

  it("matches files inside a claimed directory", () => {
    expect(resourceOverlaps("src/charges", "src/charges/create.ts")).toBe(true);
    expect(resourceOverlaps("src/charges/", "src/charges/retry.ts")).toBe(true);
  });

  it("does not match a sibling with a shared prefix", () => {
    // "src/charges" must not claim "src/charges_old.ts". A false conflict
    // teaches agents to ignore conflict warnings entirely.
    expect(resourceOverlaps("src/charges", "src/charges_old.ts")).toBe(false);
    expect(resourceOverlaps("src/a.ts", "src/a.ts.bak")).toBe(false);
  });

  it("does not match upward", () => {
    expect(resourceOverlaps("src/charges/create.ts", "src/charges")).toBe(false);
  });
});

describe("checkIn", () => {
  it("returns peers with what they are doing and holding", async () => {
    tables.agent_sessions.push(
      session({
        id: PEER,
        external_id: "codex-peer",
        agent_tool: "codex",
        account_label: "plan-b",
        current_intent: "rewriting the retry middleware",
      })
    );
    tables.project_claims.push({
      session_id: PEER,
      project_id: PROJECT,
      resource: "src/charges/retry.ts",
      intent: "rewriting the retry middleware",
      released_at: null,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

    const result = await checkIn(makeClient(), WORKSPACE, ME);

    expect(result.peers).toHaveLength(1);
    expect(result.peers[0].session_id).toBe(PEER);
    expect(result.peers[0].current_intent).toBe("rewriting the retry middleware");
    expect(result.peers[0].claims).toEqual(["src/charges/retry.ts"]);
  });

  it("does not report my own events back to me as news", async () => {
    tables.session_events.push(
      {
        session_id: ME,
        project_id: PROJECT,
        event_type: "file_edit",
        summary: "my own edit",
        importance: 4,
        files: ["src/a.ts"],
        occurred_at: "2026-09-09T10:30:00.000Z",
        created_at: "2026-09-09T10:30:00.000Z",
      },
      {
        session_id: PEER,
        project_id: PROJECT,
        event_type: "file_edit",
        summary: "peer edit",
        importance: 4,
        files: ["src/b.ts"],
        occurred_at: "2026-09-09T10:31:00.000Z",
        created_at: "2026-09-09T10:31:00.000Z",
      }
    );

    const result = await checkIn(makeClient(), WORKSPACE, ME);

    expect(result.events.map((e) => e.summary)).toEqual(["peer edit"]);
  });

  it("warns me when someone edited a file I claimed", async () => {
    tables.agent_sessions.push(
      session({ id: PEER, external_id: "codex-peer", agent_tool: "codex", account_label: "plan-b" })
    );
    tables.project_claims.push({
      session_id: ME,
      project_id: PROJECT,
      resource: "src/charges",
      intent: "adding idempotency",
      released_at: null,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    tables.session_events.push({
      session_id: PEER,
      project_id: PROJECT,
      event_type: "file_edit",
      summary: "refactored the charge builder",
      importance: 4,
      files: ["src/charges/create.ts"],
      occurred_at: "2026-09-09T10:31:00.000Z",
      created_at: "2026-09-09T10:31:00.000Z",
    });

    const result = await checkIn(makeClient(), WORKSPACE, ME);

    const conflict = result.conflicts.find(
      (c) => c.reason === "someone_edited_my_claim"
    );
    expect(conflict).toBeDefined();
    expect(conflict!.resource).toBe("src/charges/create.ts");
    expect(conflict!.other_session_id).toBe(PEER);
    // The label names the account, which is what makes it actionable.
    expect(conflict!.other_label).toContain("plan-b");
    expect(conflict!.detail).toContain("refactored the charge builder");
  });

  it("reports who holds a resource I asked for, rather than erroring", async () => {
    tables.agent_sessions.push(
      session({ id: PEER, external_id: "codex-peer", agent_tool: "codex", account_label: "plan-b" })
    );
    tables.project_claims.push({
      session_id: PEER,
      project_id: PROJECT,
      resource: "src/charges/retry.ts",
      intent: "rewriting the retry middleware",
      released_at: null,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

    const result = await checkIn(makeClient(), WORKSPACE, ME, {
      claim: [{ resource: "src/charges/retry.ts", intent: "adding backoff" }],
    });

    const outcome = result.claim_outcomes[0];
    expect(outcome.granted).toBe(false);
    expect(outcome.held_by).toBe(PEER);
    expect(outcome.held_intent).toBe("rewriting the retry middleware");

    const conflict = result.conflicts.find(
      (c) => c.reason === "my_claim_request_refused"
    );
    expect(conflict).toBeDefined();
    // An agent needs to know WHY, so it can decide to wait or work elsewhere.
    expect(conflict!.detail).toContain("rewriting the retry middleware");
  });

  it("grants an uncontested claim and reports it as held", async () => {
    const result = await checkIn(makeClient(), WORKSPACE, ME, {
      claim: [{ resource: "src/charges/create.ts", intent: "adding idempotency" }],
    });

    expect(result.claim_outcomes[0].granted).toBe(true);
    expect(result.holding.map((h) => h.resource)).toContain("src/charges/create.ts");
  });

  it("releases before it claims, so a handover works in one call", async () => {
    tables.project_claims.push({
      session_id: ME,
      project_id: PROJECT,
      resource: "src/old.ts",
      intent: null,
      released_at: null,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

    await checkIn(makeClient(), WORKSPACE, ME, {
      release: ["src/old.ts"],
      claim: [{ resource: "src/new.ts" }],
    });

    const order = rpcCalls.map((c) => c.fn);
    expect(order).toEqual(["release_claims", "claim_resources"]);
    expect(
      tables.project_claims.find((c) => c.resource === "src/old.ts")!.released_at
    ).not.toBeNull();
  });

  it("delivers broadcasts and direct messages to me, but not others' mail", async () => {
    tables.project_notices.push(
      {
        id: "n1",
        project_id: PROJECT,
        from_session_id: PEER,
        to_session_id: null,
        kind: "broadcast",
        body: "schema changed",
        importance: 3,
        created_at: "2026-09-09T10:31:00.000Z",
      },
      {
        id: "n2",
        project_id: PROJECT,
        from_session_id: PEER,
        to_session_id: ME,
        kind: "direct",
        body: "for you",
        importance: 3,
        created_at: "2026-09-09T10:32:00.000Z",
      },
      {
        id: "n3",
        project_id: PROJECT,
        from_session_id: PEER,
        to_session_id: "somebody-else",
        kind: "direct",
        body: "not for you",
        importance: 3,
        created_at: "2026-09-09T10:33:00.000Z",
      },
      {
        id: "n4",
        project_id: PROJECT,
        from_session_id: ME,
        to_session_id: null,
        kind: "broadcast",
        body: "my own notice",
        importance: 3,
        created_at: "2026-09-09T10:34:00.000Z",
      }
    );

    const result = await checkIn(makeClient(), WORKSPACE, ME);
    const bodies = result.notices.map((n) => n.body);

    expect(bodies).toContain("schema changed");
    expect(bodies).toContain("for you");
    expect(bodies).not.toContain("not for you");
    expect(bodies).not.toContain("my own notice");
  });

  it("surfaces unanswered questions even when older than the cursor", async () => {
    // A question nobody answered is still open whether it was asked two minutes
    // or two hours ago. Filtering it by the delta window is how questions get
    // silently dropped.
    tables.project_notices.push({
      id: "q1",
      project_id: PROJECT,
      from_session_id: PEER,
      to_session_id: null,
      kind: "question",
      body: "Should replays older than 24h be rejected?",
      importance: 4,
      answered_at: null,
      created_at: "2026-09-09T08:00:00.000Z",
    });

    const result = await checkIn(makeClient(), WORKSPACE, ME);

    expect(result.open_questions).toHaveLength(1);
    expect(result.open_questions[0].body).toContain("24h");
    // And it is NOT in the delta, which only covers the window.
    expect(result.notices.map((n) => n.id)).not.toContain("q1");
  });

  it("advances the cursor and records the intent", async () => {
    const result = await checkIn(makeClient(), WORKSPACE, ME, {
      intent: "adding the idempotency column",
    });

    const me = tables.agent_sessions.find((s) => s.id === ME)!;
    expect(me.current_intent).toBe("adding the idempotency column");
    expect(me.checkin_count).toBe(4);
    expect(String(me.last_checkin_at) > "2026-09-09T10:00:00.000Z").toBe(true);
    expect(result.next_checkin_after_seconds).toBe(SUGGESTED_CHECKIN_SECONDS);
  });

  it("refuses a session from another workspace", async () => {
    await expect(
      checkIn(makeClient(), "someone-else", ME)
    ).rejects.toThrow(/not found/i);
  });

  it("suggests checking in well before claims expire", () => {
    // A single missed check-in must never cost an agent its claims.
    expect(SUGGESTED_CHECKIN_SECONDS * 2).toBeLessThan(DEFAULT_CLAIM_TTL_SECONDS);
  });
});
