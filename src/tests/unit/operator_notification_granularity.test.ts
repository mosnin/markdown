/**
 * Operator notification granularity (gap #5) tests.
 *
 * Covers the three additions from 20260420000006 /
 * operator_notifications_service:
 *
 *   1. OperatorNotificationPrefs surfaces the new fields
 *      (emailOnApprovalNeeded, emailOnCancel, digestEnabled) with the
 *      documented defaults and round-trips through set/get.
 *   2. notifyRunAwaitingApproval gates on `email_on_approval_needed`
 *      — true → calls Resend, false → returns {sent:false, reason:"disabled"}.
 *   3. Same contract for notifyRunCancelled against `email_on_cancel`.
 *
 * We use the same hand-rolled Supabase fake used by
 * operator_notifications_service.test.ts — a fluent builder whose
 * terminal `maybeSingle` / `then` methods return the row the test
 * configured. No actual DB or network calls are made; `fetch` is
 * stubbed when a Resend post is expected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getNotificationPrefs,
  setNotificationPrefs,
  notifyRunAwaitingApproval,
  notifyRunCancelled,
} from "@/server/services/operator_notifications_service";

interface FakePrefsRow {
  user_id: string;
  email_on_complete: boolean;
  email_on_fail: boolean;
  email_on_approval_needed?: boolean | null;
  email_on_cancel?: boolean | null;
  digest_enabled?: boolean | null;
  updated_at: string;
}

interface FakeRunRow {
  id: string;
  workspace_id: string;
  user_id: string;
  prompt: string;
  notes_created: string[];
  tool_calls: number;
  error: string | null;
}

interface FakeOpts {
  prefsRow?: FakePrefsRow | null;
  prefsError?: { message: string } | null;
  upsertError?: { message: string } | null;
  runRow?: FakeRunRow | null;
  email?: string | null;
  /** Capture the upsert payload so tests can assert on the write shape. */
  onUpsert?: (payload: unknown) => void;
}

function makeSupabase(opts: FakeOpts) {
  function builder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};
    let lastOp: "select" | "upsert" = "select";
    let upsertPayload: unknown = null;
    b.select = () => b;
    b.eq = () => b;
    b.upsert = (payload: unknown) => {
      lastOp = "upsert";
      upsertPayload = payload;
      return b;
    };
    b.maybeSingle = async () => {
      if (table === "operator_notification_preferences") {
        return { data: opts.prefsRow ?? null, error: opts.prefsError ?? null };
      }
      if (table === "workspace_operator_runs") {
        return { data: opts.runRow ?? null, error: null };
      }
      return { data: null, error: null };
    };
    b.then = (resolve: (v: unknown) => void) => {
      if (lastOp === "upsert") {
        opts.onUpsert?.(upsertPayload);
        resolve({ data: null, error: opts.upsertError ?? null });
        return;
      }
      resolve({ data: null, error: null });
    };
    return b;
  }
  return {
    from: builder,
    auth:
      opts.email !== undefined
        ? {
            admin: {
              getUserById: async () => ({
                data: { user: { email: opts.email } },
              }),
            },
          }
        : { admin: undefined },
  };
}

const ENV_BACKUP = process.env;
beforeEach(() => {
  process.env = { ...ENV_BACKUP, RESEND_API_KEY: "" };
});
afterEach(() => {
  process.env = ENV_BACKUP;
  vi.unstubAllGlobals();
});

// ─── Prefs shape ────────────────────────────────────────────────────────────

describe("OperatorNotificationPrefs — gap #5 shape", () => {
  it("defaults the three new fields to false when no row exists", async () => {
    const s = makeSupabase({ prefsRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = await getNotificationPrefs(s as any, "u-1");
    expect(prefs).toEqual({
      emailOnComplete: false,
      emailOnFail: true,
      emailOnApprovalNeeded: false,
      emailOnCancel: false,
      digestEnabled: false,
    });
  });

  it("reads the new columns when present on the stored row", async () => {
    const s = makeSupabase({
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: true,
        email_on_approval_needed: true,
        email_on_cancel: true,
        digest_enabled: true,
        updated_at: "2026-04-20T00:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = await getNotificationPrefs(s as any, "u-1");
    expect(prefs).toEqual({
      emailOnComplete: false,
      emailOnFail: true,
      emailOnApprovalNeeded: true,
      emailOnCancel: true,
      digestEnabled: true,
    });
  });

  it("coerces null/undefined new columns to false (back-compat with pre-gap-#5 rows)", async () => {
    const s = makeSupabase({
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: true,
        // email_on_approval_needed / email_on_cancel / digest_enabled absent
        updated_at: "2026-04-20T00:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = await getNotificationPrefs(s as any, "u-1");
    expect(prefs.emailOnApprovalNeeded).toBe(false);
    expect(prefs.emailOnCancel).toBe(false);
    expect(prefs.digestEnabled).toBe(false);
  });

  it("setNotificationPrefs writes the new columns in the upsert payload", async () => {
    let captured: unknown = null;
    const s = makeSupabase({
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: true,
        email_on_approval_needed: false,
        email_on_cancel: false,
        digest_enabled: false,
        updated_at: "2026-04-20T00:00:00Z",
      },
      onUpsert: (p) => {
        captured = p;
      },
    });
    const next = await setNotificationPrefs(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s as any,
      "u-1",
      { emailOnApprovalNeeded: true, emailOnCancel: true }
    );
    expect(next.emailOnApprovalNeeded).toBe(true);
    expect(next.emailOnCancel).toBe(true);
    // The canonical DB columns must appear in the upsert payload — if a
    // future refactor drops them the writes would silently no-op.
    expect(captured).toMatchObject({
      user_id: "u-1",
      email_on_approval_needed: true,
      email_on_cancel: true,
      digest_enabled: false,
    });
  });
});

// ─── notifyRunAwaitingApproval ──────────────────────────────────────────────

describe("notifyRunAwaitingApproval", () => {
  const baseRun: FakeRunRow = {
    id: "r-approval",
    workspace_id: "ws-1",
    user_id: "u-1",
    prompt: "plan something",
    notes_created: [],
    tool_calls: 0,
    error: null,
  };

  it("returns disabled when email_on_approval_needed is false", async () => {
    const s = makeSupabase({
      runRow: baseRun,
      prefsRow: {
        user_id: "u-1",
        email_on_complete: true,
        email_on_fail: true,
        email_on_approval_needed: false,
        email_on_cancel: true,
        digest_enabled: false,
        updated_at: "now",
      },
      email: "owner@example.com",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunAwaitingApproval(s as any, "r-approval");
    expect(out).toEqual({ sent: false, reason: "disabled" });
  });

  it("posts to Resend when email_on_approval_needed is true", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const s = makeSupabase({
      runRow: baseRun,
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: false,
        email_on_approval_needed: true,
        email_on_cancel: false,
        digest_enabled: false,
        updated_at: "now",
      },
      email: "owner@example.com",
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunAwaitingApproval(s as any, "r-approval");
    expect(out).toEqual({ sent: true, channel: "email" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" })
    );
    // Subject line communicates the awaiting-approval state so the user
    // can triage directly from the inbox.
    const call = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(call[1].body) as { subject: string };
    expect(body.subject).toMatch(/awaiting approval/i);
  });

  it("returns no_run when the run id is unknown", async () => {
    const s = makeSupabase({ runRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunAwaitingApproval(s as any, "nope");
    expect(out).toEqual({ sent: false, reason: "no_run" });
  });
});

// ─── notifyRunCancelled ─────────────────────────────────────────────────────

describe("notifyRunCancelled", () => {
  const baseRun: FakeRunRow = {
    id: "r-cancel",
    workspace_id: "ws-1",
    user_id: "u-1",
    prompt: "do it",
    notes_created: [],
    tool_calls: 0,
    error: null,
  };

  it("returns disabled when email_on_cancel is false", async () => {
    const s = makeSupabase({
      runRow: baseRun,
      prefsRow: {
        user_id: "u-1",
        email_on_complete: true,
        email_on_fail: true,
        email_on_approval_needed: true,
        email_on_cancel: false,
        digest_enabled: false,
        updated_at: "now",
      },
      email: "owner@example.com",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunCancelled(s as any, "r-cancel");
    expect(out).toEqual({ sent: false, reason: "disabled" });
  });

  it("posts to Resend when email_on_cancel is true", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const s = makeSupabase({
      runRow: baseRun,
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: false,
        email_on_approval_needed: false,
        email_on_cancel: true,
        digest_enabled: false,
        updated_at: "now",
      },
      email: "owner@example.com",
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunCancelled(s as any, "r-cancel");
    expect(out).toEqual({ sent: true, channel: "email" });
    const call = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(call[1].body) as { subject: string };
    expect(body.subject).toMatch(/cancelled/i);
  });

  it("returns no_api_key (does NOT throw) when RESEND_API_KEY is unset and user is opted in", async () => {
    const s = makeSupabase({
      runRow: baseRun,
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: false,
        email_on_approval_needed: false,
        email_on_cancel: true,
        digest_enabled: false,
        updated_at: "now",
      },
      email: "owner@example.com",
    });
    // RESEND_API_KEY left blank by beforeEach.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunCancelled(s as any, "r-cancel");
    expect(out).toEqual({ sent: false, reason: "no_api_key" });
  });
});
