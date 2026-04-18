import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendDigestBatch } from "@/server/services/email_digest_service";

/**
 * Unit tests for the email digest service.
 *
 * Covers:
 *  - No eligible users -> sent=0
 *  - Users with activity -> sent=N, one fetch per user
 *  - RESEND_API_KEY missing -> skipped=N, no fetches
 *  - Fetch failure for one user -> failed++, others still sent
 *  - Users with zero new activity are skipped without a send
 */

interface FakeRow {
  [key: string]: unknown;
}

interface InitialData {
  user_notification_preferences?: FakeRow[];
  audit_events?: FakeRow[];
  workspaces?: FakeRow[];
}

function makeFakeSupabase(
  initial: InitialData = {},
  users: Record<string, string | null> = {}
) {
  const tables: Record<string, FakeRow[]> = {
    user_notification_preferences: initial.user_notification_preferences ?? [],
    audit_events: initial.audit_events ?? [],
    workspaces: initial.workspaces ?? [],
  };

  function buildQuery(tableName: string) {
    const filters: Array<(r: FakeRow) => boolean> = [];
    let ordering: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;

    const chain: Record<string, unknown> = {
      select: (_cols: string) => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return chain;
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val);
        return chain;
      },
      gt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) > (val as string));
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
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      then: async (resolve: (val: unknown) => void) => {
        let result = [...(tables[tableName] ?? [])];
        for (const f of filters) result = result.filter(f);
        if (ordering) {
          const { col, asc } = ordering;
          result.sort((a, b) => {
            const av = a[col] as string;
            const bv = b[col] as string;
            if (av < bv) return asc ? -1 : 1;
            if (av > bv) return asc ? 1 : -1;
            return 0;
          });
        }
        if (limitN !== null) result = result.slice(0, limitN);
        resolve({ data: result, error: null });
      },
    };
    return chain;
  }

  return {
    from: (tableName: string) => buildQuery(tableName),
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: users[id] ? { email: users[id] } : null },
        }),
      },
    },
    _tables: tables,
  } as unknown as Parameters<typeof sendDigestBatch>[0];
}

function makePrefRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    user_id: "user-1",
    workspace_id: "ws-1",
    note_created: true,
    note_updated: false,
    link_created: true,
    branch_promoted: true,
    member_joined: true,
    proposal_submitted: true,
    email_digest: "daily",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: crypto.randomUUID(),
    workspace_id: "ws-1",
    actor_type: "user",
    actor_id: "other-user",
    object_type: "note",
    object_id: "note-1",
    event_type: "note.created",
    metadata: { title: "A note" },
    // A second ago — comfortably inside the 24h window.
    created_at: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}

// ─── Env + fetch lifecycle ──────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
const originalKey = process.env.RESEND_API_KEY;
const originalFromDomain = process.env.RESEND_FROM_DOMAIN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  if (originalFromDomain === undefined) delete process.env.RESEND_FROM_DOMAIN;
  else process.env.RESEND_FROM_DOMAIN = originalFromDomain;
});

beforeEach(() => {
  process.env.RESEND_FROM_DOMAIN = "mail.example.com";
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("email_digest_service — sendDigestBatch", () => {
  it("returns zeros when no preference rows match the cadence", async () => {
    process.env.RESEND_API_KEY = "re_test_123";

    const sb = makeFakeSupabase({
      user_notification_preferences: [
        makePrefRow({ email_digest: "weekly" }), // wrong cadence
        makePrefRow({ email_digest: "none", user_id: "user-2" }),
      ],
    });

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendDigestBatch(sb, "daily");

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a digest for each user with activity", async () => {
    process.env.RESEND_API_KEY = "re_test_123";

    const sb = makeFakeSupabase(
      {
        user_notification_preferences: [
          makePrefRow({ user_id: "user-1", workspace_id: "ws-1" }),
          makePrefRow({ user_id: "user-2", workspace_id: "ws-2" }),
        ],
        workspaces: [
          { id: "ws-1", name: "Acme" },
          { id: "ws-2", name: "Beta Corp" },
        ],
        audit_events: [
          makeEvent({ workspace_id: "ws-1", actor_id: "someone-else", metadata: { title: "Note A" } }),
          makeEvent({ workspace_id: "ws-1", actor_id: "someone-else", event_type: "note_link.created", metadata: { title: "Link B" } }),
          makeEvent({ workspace_id: "ws-2", actor_id: "yet-another", metadata: { title: "Note C" } }),
        ],
      },
      { "user-1": "alice@example.com", "user-2": "bob@example.com" }
    );

    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendDigestBatch(sb, "daily");

    expect(result).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toBe("https://api.resend.com/emails");
    const init = firstCall[1];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_123");

    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
    };
    expect(body.from).toBe("Context Store <digest@mail.example.com>");
    expect(body.to[0]).toMatch(/@example\.com$/);
    expect(body.subject).toContain("daily digest");
  });

  it("excludes the user's own actions from their digest", async () => {
    process.env.RESEND_API_KEY = "re_test_123";

    const sb = makeFakeSupabase(
      {
        user_notification_preferences: [makePrefRow({ user_id: "user-1" })],
        workspaces: [{ id: "ws-1", name: "Acme" }],
        audit_events: [
          // Only event is by the user themselves — digest should skip.
          makeEvent({ workspace_id: "ws-1", actor_id: "user-1" }),
        ],
      },
      { "user-1": "alice@example.com" }
    );

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendDigestBatch(sb, "daily");

    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips users with zero new activity", async () => {
    process.env.RESEND_API_KEY = "re_test_123";

    const sb = makeFakeSupabase(
      {
        user_notification_preferences: [
          makePrefRow({ user_id: "user-1", workspace_id: "ws-1" }),
          makePrefRow({ user_id: "user-2", workspace_id: "ws-2" }),
        ],
        workspaces: [
          { id: "ws-1", name: "Acme" },
          { id: "ws-2", name: "Beta" },
        ],
        audit_events: [
          // Only user-1's workspace has an event.
          makeEvent({ workspace_id: "ws-1" }),
        ],
      },
      { "user-1": "alice@example.com", "user-2": "bob@example.com" }
    );

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendDigestBatch(sb, "daily");

    expect(result).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("counts eligible users as skipped when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;

    const sb = makeFakeSupabase(
      {
        user_notification_preferences: [makePrefRow({ user_id: "user-1" })],
        workspaces: [{ id: "ws-1", name: "Acme" }],
        audit_events: [makeEvent({ workspace_id: "ws-1" })],
      },
      { "user-1": "alice@example.com" }
    );

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendDigestBatch(sb, "daily");

    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("continues the batch when one user's send fails", async () => {
    process.env.RESEND_API_KEY = "re_test_123";

    const sb = makeFakeSupabase(
      {
        user_notification_preferences: [
          makePrefRow({ user_id: "user-1", workspace_id: "ws-1" }),
          makePrefRow({ user_id: "user-2", workspace_id: "ws-2" }),
        ],
        workspaces: [
          { id: "ws-1", name: "Acme" },
          { id: "ws-2", name: "Beta" },
        ],
        audit_events: [
          makeEvent({ workspace_id: "ws-1" }),
          makeEvent({ workspace_id: "ws-2" }),
        ],
      },
      { "user-1": "alice@example.com", "user-2": "bob@example.com" }
    );

    // First call fails (500), second call succeeds.
    let callCount = 0;
    const fetchSpy = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("boom", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendDigestBatch(sb, "daily");

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("applies the 7-day window for weekly cadence", async () => {
    process.env.RESEND_API_KEY = "re_test_123";

    const fourDaysAgo = new Date(
      Date.now() - 4 * 24 * 60 * 60 * 1000
    ).toISOString();

    const sb = makeFakeSupabase(
      {
        user_notification_preferences: [
          makePrefRow({ user_id: "user-1", email_digest: "weekly" }),
        ],
        workspaces: [{ id: "ws-1", name: "Acme" }],
        audit_events: [
          // 4 days old — outside daily (24h) but inside weekly (7d).
          makeEvent({ workspace_id: "ws-1", created_at: fourDaysAgo }),
        ],
      },
      { "user-1": "alice@example.com" }
    );

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const weeklyResult = await sendDigestBatch(sb, "weekly");
    expect(weeklyResult.sent).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
