import { describe, it, expect } from "vitest";
import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Unit tests for handoff brief assembly.
 *
 * The brief is the product: it is what a fresh agent reads instead of
 * rediscovering three hours of work. The invariants worth pinning are about
 * WHAT SURVIVES, not about exact prose:
 *
 *   1. A usage cap is stated plainly. "The last session did not finish" is the
 *      single most important fact in a handoff, and it must never be the thing
 *      the budget cuts.
 *   2. Blockers outrank decisions outrank next steps outrank the raw timeline.
 *      A tight budget keeps the expensive-to-rediscover things.
 *   3. The output fits the budget.
 *   4. Assembly is deterministic — same log, same brief, byte for byte.
 *   5. The requesting session never appears in its own history.
 *
 * Mocking strategy: a chainable stub that returns per-table fixtures. The
 * repositories only ever use select/eq/neq/in/gte/gt/order/limit/maybeSingle,
 * so a stub that records filters and replays a fixture list is enough, and it
 * keeps these tests honest about the real call shapes.
 */

import {
  assembleBrief,
  estimateTokens,
  mergeStates,
} from "@/server/services/handoff_brief_service";
import { type SessionState } from "@/server/domain/types/agent_session";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_A = "33333333-3333-3333-3333-333333333333";
const SESSION_B = "44444444-4444-4444-4444-444444444444";

const PROJECT = {
  id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  name: "checkout-service",
  slug: "acme-checkout-service",
  description: null,
  repo_url: null,
  default_branch: "main",
  status: "active",
  session_count: 2,
  last_active_at: "2026-09-09T10:00:00.000Z",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-09T10:00:00.000Z",
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_A,
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    external_id: "cc-abc",
    agent_tool: "claude_code",
    agent_model: "claude-opus-5",
    account_label: "plan-a",
    agent_version: null,
    host: "laptop",
    cwd: "~/code/checkout",
    git_branch: "feat/idempotent-charges",
    git_commit: "abc1234",
    title: "Make charge creation idempotent",
    goal: "Make charge creation idempotent",
    status: "ended",
    end_reason: "usage_capped",
    resumed_from_session_id: null,
    event_count: 120,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    metadata: null,
    started_at: "2026-09-09T08:00:00.000Z",
    last_seen_at: "2026-09-09T10:00:00.000Z",
    ended_at: "2026-09-09T10:00:00.000Z",
    created_at: "2026-09-09T08:00:00.000Z",
    updated_at: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

function makeCheckpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: "cp-1",
    workspace_id: WORKSPACE_ID,
    project_id: PROJECT_ID,
    session_id: SESSION_A,
    kind: "session_end",
    seq_from: 0,
    seq_to: 120,
    summary: "Added an idempotency key column and wired it through the charge path.",
    state: {
      goal: "Make charge creation idempotent",
      done: ["Added idempotency_key column", "Backfilled existing rows"],
      in_flight: ["Retry middleware is half-written in src/charges/retry.ts"],
      blocked: [
        "Stripe test mode rejects duplicate keys within 60s — the integration test cannot assert replay this way",
      ],
      decisions: [
        "Key on (merchant_id, request_id), not on request body hash",
        "Return 200 with the original charge on replay, not 409",
      ],
      next_steps: ["Finish retry middleware", "Add the replay integration test"],
      open_questions: ["Should replays older than 24h be rejected?"],
      files_touched: ["src/charges/create.ts", "src/charges/retry.ts"],
    },
    token_estimate: 200,
    created_at: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Minimal chainable Supabase stub.
 *
 * Every filter/ordering method returns `this` and records nothing beyond what
 * the assertions need; terminal methods resolve the fixture registered for the
 * table. `neq` is honoured because excluding the requesting session is a
 * behaviour we assert on.
 */
function makeClient(fixtures: {
  projects?: unknown[];
  agent_sessions?: unknown[];
  session_checkpoints?: unknown[];
  session_events?: unknown[];
}): SupabaseClient {
  const client = {
    from(table: string) {
      let rows = [...((fixtures as Record<string, unknown[]>)[table] ?? [])];

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        gt: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        neq: (column: string, value: unknown) => {
          rows = rows.filter(
            (row) => (row as Record<string, unknown>)[column] !== value
          );
          return builder;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: null }),
        // Awaiting the builder itself is how the list queries terminate.
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

describe("estimateTokens", () => {
  it("approximates four characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(4000))).toBe(1000);
  });
});

describe("mergeStates", () => {
  it("concatenates list fields newest-first and de-duplicates case-insensitively", () => {
    const merged = mergeStates([
      { decisions: ["Use Postgres", "Key on request_id"] },
      { decisions: ["use postgres", "Retry with backoff"] },
    ]);
    expect(merged.decisions).toEqual([
      "Use Postgres",
      "Key on request_id",
      "Retry with backoff",
    ]);
  });

  it("takes the goal from the newest state that states one", () => {
    const merged = mergeStates([
      { goal: "" } as SessionState,
      { goal: "Ship idempotent charges" },
      { goal: "An older, superseded goal" },
    ]);
    expect(merged.goal).toBe("Ship idempotent charges");
  });

  it("omits fields no session reported rather than emitting empty arrays", () => {
    const merged = mergeStates([{ done: ["a"] }]);
    expect(merged.done).toEqual(["a"]);
    expect(merged.blocked).toBeUndefined();
    expect("goal" in merged).toBe(false);
  });
});

describe("assembleBrief", () => {
  it("says plainly that the last session was cut off by a usage cap", async () => {
    const client = makeClient({
      projects: [PROJECT],
      agent_sessions: [makeSession()],
      session_checkpoints: [makeCheckpoint()],
      session_events: [],
    });

    const brief = await assembleBrief(client, WORKSPACE_ID, {
      project_id: PROJECT_ID,
    });

    expect(brief.body).toContain("usage cap");
    expect(brief.body).toContain("not finished");
    expect(brief.empty).toBe(false);
  });

  it("orders sections so blockers and decisions precede the raw log", async () => {
    const client = makeClient({
      projects: [PROJECT],
      agent_sessions: [makeSession()],
      session_checkpoints: [makeCheckpoint()],
      session_events: [],
    });

    const { body } = await assembleBrief(client, WORKSPACE_ID, {
      project_id: PROJECT_ID,
    });

    const blocked = body.indexOf("Blocked / already tried");
    const decisions = body.indexOf("Decisions already made");
    const nextSteps = body.indexOf("Planned next steps");
    const files = body.indexOf("Files touched");

    expect(blocked).toBeGreaterThan(-1);
    expect(blocked).toBeLessThan(decisions);
    expect(decisions).toBeLessThan(nextSteps);
    // Files come last: an agent can read the repo, but it cannot recover a
    // decision nobody wrote down.
    expect(nextSteps).toBeLessThan(files);
  });

  it("keeps blockers and drops low-priority sections when the budget is tight", async () => {
    // A realistic session: enough accumulated state that a 500-token budget
    // genuinely cannot carry all of it, which is the case the priority
    // ordering exists for.
    const verbose = makeCheckpoint({
      summary: "Worked the idempotency path end to end. ".repeat(20),
      state: {
        ...(makeCheckpoint().state as Record<string, unknown>),
        done: Array.from(
          { length: 12 },
          (_, i) => `Completed step ${i}: refactored a call site and updated its test`
        ),
        files_touched: Array.from(
          { length: 30 },
          (_, i) => `src/charges/module_${i}/implementation_file.ts`
        ),
      },
    });

    const client = makeClient({
      projects: [PROJECT],
      agent_sessions: [makeSession()],
      session_checkpoints: [verbose],
      session_events: [],
    });

    const { body, token_estimate } = await assembleBrief(client, WORKSPACE_ID, {
      project_id: PROJECT_ID,
      budget_tokens: 500,
    });

    expect(token_estimate).toBeLessThanOrEqual(500);
    expect(body).toContain("Stripe test mode rejects duplicate keys");
    expect(body).not.toContain("Files touched");
    expect(body).toContain("omitted to fit");
  });

  it("stays within a generous budget too", async () => {
    const client = makeClient({
      projects: [PROJECT],
      agent_sessions: [makeSession()],
      session_checkpoints: [makeCheckpoint()],
      session_events: [],
    });

    const { token_estimate, budget_tokens } = await assembleBrief(
      client,
      WORKSPACE_ID,
      { project_id: PROJECT_ID, budget_tokens: 8000 }
    );

    expect(token_estimate).toBeLessThanOrEqual(budget_tokens);
  });

  it("is deterministic for the same inputs", async () => {
    const fixtures = {
      projects: [PROJECT],
      agent_sessions: [makeSession()],
      session_checkpoints: [makeCheckpoint()],
      session_events: [],
    };

    const first = await assembleBrief(makeClient(fixtures), WORKSPACE_ID, {
      project_id: PROJECT_ID,
    });
    const second = await assembleBrief(makeClient(fixtures), WORKSPACE_ID, {
      project_id: PROJECT_ID,
    });

    expect(first.body).toBe(second.body);
  });

  it("excludes the requesting session from its own history", async () => {
    const client = makeClient({
      projects: [PROJECT],
      agent_sessions: [
        makeSession({ id: SESSION_B, account_label: "plan-b", status: "active", end_reason: null, ended_at: null }),
        makeSession(),
      ],
      session_checkpoints: [makeCheckpoint()],
      session_events: [],
    });

    const brief = await assembleBrief(client, WORKSPACE_ID, {
      project_id: PROJECT_ID,
      requesting_session_id: SESSION_B,
    });

    expect(brief.source_session_ids).toEqual([SESSION_A]);
    expect(brief.source_session_ids).not.toContain(SESSION_B);
  });

  it("tells the first agent on a project that it is the first", async () => {
    const client = makeClient({
      projects: [PROJECT],
      agent_sessions: [],
      session_checkpoints: [],
      session_events: [],
    });

    const brief = await assembleBrief(client, WORKSPACE_ID, {
      project_id: PROJECT_ID,
    });

    expect(brief.empty).toBe(true);
    expect(brief.body).toContain("You are the first");
    expect(brief.source_session_ids).toEqual([]);
  });

  it("refuses a project from another workspace", async () => {
    const client = makeClient({
      projects: [{ ...PROJECT, workspace_id: "someone-else" }],
    });

    await expect(
      assembleBrief(client, WORKSPACE_ID, { project_id: PROJECT_ID })
    ).rejects.toThrow(/not found/i);
  });

  it("falls back to salient events when a session has no checkpoint", async () => {
    const client = makeClient({
      projects: [PROJECT],
      agent_sessions: [makeSession({ event_count: 3 })],
      session_checkpoints: [],
      session_events: [
        {
          id: "e1",
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          session_id: SESSION_A,
          sequence: 2,
          event_type: "decision",
          summary: "Chose optimistic locking over a table lock",
          payload: null,
          actor: "agent",
          tool_name: null,
          files: [],
          importance: 5,
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0,
          client_event_id: null,
          redacted_at: null,
          occurred_at: "2026-09-09T09:00:00.000Z",
          created_at: "2026-09-09T09:00:00.000Z",
        },
      ],
    });

    const { body } = await assembleBrief(client, WORKSPACE_ID, {
      project_id: PROJECT_ID,
    });

    expect(body).toContain("Chose optimistic locking");
    expect(body).toContain("Session log");
  });
});
