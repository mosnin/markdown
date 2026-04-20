import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getNotificationPrefs,
  setNotificationPrefs,
  notifyRunCompleted,
  notifyRunFailed,
} from "@/server/services/operator_notifications_service";

// ─── Helpers ────────────────────────────────────────────────────────────────

interface FakeOpts {
  prefsRow?:
    | {
        user_id: string;
        email_on_complete: boolean;
        email_on_fail: boolean;
        updated_at: string;
      }
    | null;
  prefsError?: { message: string } | null;
  upsertError?: { message: string } | null;
  runRow?:
    | {
        id: string;
        workspace_id: string;
        user_id: string;
        prompt: string;
        notes_created: string[];
        tool_calls: number;
        error: string | null;
      }
    | null;
  /** Optional auth.admin shim that resolves a user email by id. */
  email?: string | null;
}

function makeSupabase(opts: FakeOpts) {
  function builder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: Record<string, any> = {};
    let lastOp: "select" | "upsert" = "select";
    b.select = () => b;
    b.eq = () => b;
    b.upsert = () => {
      lastOp = "upsert";
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
        resolve({ data: null, error: opts.upsertError ?? null });
        return;
      }
      resolve({ data: null, error: null });
    };
    return b;
  }
  return {
    from: builder,
    auth: opts.email !== undefined
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

// ─── getNotificationPrefs ───────────────────────────────────────────────────

describe("getNotificationPrefs", () => {
  it("falls back to defaults when no row exists", async () => {
    const s = makeSupabase({ prefsRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = await getNotificationPrefs(s as any, "u-1");
    expect(prefs).toEqual({ emailOnComplete: false, emailOnFail: true });
  });

  it("returns the stored row when present", async () => {
    const s = makeSupabase({
      prefsRow: {
        user_id: "u-1",
        email_on_complete: true,
        email_on_fail: false,
        updated_at: "2026-04-20T00:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefs = await getNotificationPrefs(s as any, "u-1");
    expect(prefs).toEqual({ emailOnComplete: true, emailOnFail: false });
  });
});

// ─── setNotificationPrefs ───────────────────────────────────────────────────

describe("setNotificationPrefs", () => {
  it("overlays the patch on top of current values", async () => {
    const s = makeSupabase({
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: true,
        updated_at: "2026-04-20T00:00:00Z",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next = await setNotificationPrefs(s as any, "u-1", { emailOnComplete: true });
    // The unpatched field should be preserved at its current DB value.
    expect(next).toEqual({ emailOnComplete: true, emailOnFail: true });
  });
});

// ─── notify* ────────────────────────────────────────────────────────────────

describe("notifyRunCompleted / notifyRunFailed", () => {
  it("returns no_run when the run id is unknown", async () => {
    const s = makeSupabase({ runRow: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunCompleted(s as any, "missing");
    expect(out).toEqual({ sent: false, reason: "no_run" });
  });

  it("respects email_on_complete=false", async () => {
    const s = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        prompt: "do",
        notes_created: [],
        tool_calls: 0,
        error: null,
      },
      prefsRow: {
        user_id: "u-1",
        email_on_complete: false,
        email_on_fail: true,
        updated_at: "now",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunCompleted(s as any, "r-1");
    expect(out).toEqual({ sent: false, reason: "no_prefs_opt_in" });
  });

  it("returns no_email when the user email cannot be resolved", async () => {
    const s = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        prompt: "do",
        notes_created: [],
        tool_calls: 0,
        error: null,
      },
      prefsRow: {
        user_id: "u-1",
        email_on_complete: true,
        email_on_fail: true,
        updated_at: "now",
      },
      email: null, // admin shim returns null
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunCompleted(s as any, "r-1");
    expect(out).toEqual({ sent: false, reason: "no_email" });
  });

  it("returns no_api_key (and does NOT throw) when RESEND_API_KEY is unset", async () => {
    const s = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        prompt: "do",
        notes_created: ["n-1"],
        tool_calls: 1,
        error: "boom",
      },
      prefsRow: {
        user_id: "u-1",
        email_on_complete: true,
        email_on_fail: true,
        updated_at: "now",
      },
      email: "owner@example.com",
    });
    // RESEND_API_KEY left empty in beforeEach.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunFailed(s as any, "r-1");
    expect(out).toEqual({ sent: false, reason: "no_api_key" });
  });

  it("posts to Resend and returns sent: true when configured", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const s = makeSupabase({
      runRow: {
        id: "r-1",
        workspace_id: "ws-1",
        user_id: "u-1",
        prompt: "draft <something>",
        notes_created: ["n-1"],
        tool_calls: 1,
        error: null,
      },
      prefsRow: {
        user_id: "u-1",
        email_on_complete: true,
        email_on_fail: true,
        updated_at: "now",
      },
      email: "owner@example.com",
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await notifyRunCompleted(s as any, "r-1");
    expect(out).toEqual({ sent: true, channel: "email" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" })
    );
  });
});
