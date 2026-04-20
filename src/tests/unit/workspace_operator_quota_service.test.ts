import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — Agent A's usage service + the subscription service are the two
// upstream dependencies `checkOperatorQuota` leans on. Both are stubbed
// here so we can drive exact run-count scenarios without touching Supabase.
// ---------------------------------------------------------------------------

vi.mock("@/server/services/workspace_operator_usage_service", () => ({
  getWorkspaceUsageForMonth: vi.fn(async () => []),
  getUserUsageForMonth: vi.fn(async () => []),
  sumOperatorUsage: (rows: Array<{ runCount: number }>) => ({
    runCount: rows.reduce((s, r) => s + (r.runCount ?? 0), 0),
    toolCallCount: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    estimatedCostCents: 0,
  }),
}));

vi.mock("@/server/services/subscription_service", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/subscription_service")
  >("@/server/services/subscription_service");
  return {
    ...actual,
    getWorkspacePlan: vi.fn(async () => "free" as const),
  };
});

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkOperatorQuota,
  firstOfNextMonthUTC,
  OPERATOR_TIER_LIMITS,
} from "@/server/services/workspace_operator_quota_service";
import {
  getWorkspaceUsageForMonth,
  getUserUsageForMonth,
} from "@/server/services/workspace_operator_usage_service";
import { getWorkspacePlan } from "@/server/services/subscription_service";

// ---------------------------------------------------------------------------
// Supabase stub — the only method checkOperatorQuota reaches for directly
// is the override-flag lookup on workspace_subscriptions.
// ---------------------------------------------------------------------------

function makeSupabase(overrideFlag = false): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { override_operator_quota: overrideFlag },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function usageRows(runCount: number) {
  if (runCount === 0) return [];
  return [
    {
      workspaceId: "w1",
      userId: "u1",
      month: "2026-04-01",
      runCount,
      toolCallCount: 0,
      inputTokenCount: 0,
      outputTokenCount: 0,
      estimatedCostCents: 0,
    },
  ];
}

// ---------------------------------------------------------------------------

describe("OPERATOR_TIER_LIMITS", () => {
  it("exposes the expected per-tier caps", () => {
    expect(OPERATOR_TIER_LIMITS).toEqual({
      free: 5,
      pro: 50,
      business: 500,
    });
  });
});

describe("firstOfNextMonthUTC", () => {
  it("rolls a mid-month date to the first of next month in UTC", () => {
    const now = new Date(Date.UTC(2026, 3, 20, 13, 45, 0)); // Apr 20
    const next = firstOfNextMonthUTC(now);
    expect(next.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("rolls December to January of the next year", () => {
    const now = new Date(Date.UTC(2026, 11, 31, 23, 59, 0));
    const next = firstOfNextMonthUTC(now);
    expect(next.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("checkOperatorQuota — free tier (per-workspace)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspacePlan).mockResolvedValue("free");
  });

  it("allows a workspace with 0 runs", async () => {
    vi.mocked(getWorkspaceUsageForMonth).mockResolvedValue(usageRows(0));
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.tier).toBe("free");
    expect(q.limit).toBe(5);
    expect(q.used).toBe(0);
    expect(q.remaining).toBe(5);
    expect(q.allowed).toBe(true);
  });

  it("allows at 4/5 runs (remaining=1)", async () => {
    vi.mocked(getWorkspaceUsageForMonth).mockResolvedValue(usageRows(4));
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.used).toBe(4);
    expect(q.remaining).toBe(1);
    expect(q.allowed).toBe(true);
  });

  it("denies at 5/5 runs (remaining=0)", async () => {
    vi.mocked(getWorkspaceUsageForMonth).mockResolvedValue(usageRows(5));
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.used).toBe(5);
    expect(q.remaining).toBe(0);
    expect(q.allowed).toBe(false);
  });

  it("reads workspace usage, not user usage", async () => {
    vi.mocked(getWorkspaceUsageForMonth).mockResolvedValue(usageRows(0));
    await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(getWorkspaceUsageForMonth).toHaveBeenCalledTimes(1);
    expect(getUserUsageForMonth).not.toHaveBeenCalled();
  });
});

describe("checkOperatorQuota — pro tier (per-user)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspacePlan).mockResolvedValue("pro");
  });

  it("allows a pro user with 49 runs (per-user, not per-workspace)", async () => {
    vi.mocked(getUserUsageForMonth).mockResolvedValue(usageRows(49));
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.tier).toBe("pro");
    expect(q.limit).toBe(50);
    expect(q.used).toBe(49);
    expect(q.allowed).toBe(true);
    // Reads per-user usage, not per-workspace.
    expect(getUserUsageForMonth).toHaveBeenCalledTimes(1);
    expect(getWorkspaceUsageForMonth).not.toHaveBeenCalled();
  });

  it("denies a pro user at 50/50 runs", async () => {
    vi.mocked(getUserUsageForMonth).mockResolvedValue(usageRows(50));
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });
});

describe("checkOperatorQuota — business tier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspacePlan).mockResolvedValue("business");
  });

  it("allows business user at 499 runs", async () => {
    vi.mocked(getUserUsageForMonth).mockResolvedValue(usageRows(499));
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.tier).toBe("business");
    expect(q.limit).toBe(500);
    expect(q.allowed).toBe(true);
  });

  it("denies business user at 500 runs", async () => {
    vi.mocked(getUserUsageForMonth).mockResolvedValue(usageRows(500));
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.allowed).toBe(false);
  });
});

describe("checkOperatorQuota — override flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspacePlan).mockResolvedValue("free");
  });

  it("always allows when override_operator_quota is true, even on free tier at the cap", async () => {
    vi.mocked(getWorkspaceUsageForMonth).mockResolvedValue(usageRows(999));
    const q = await checkOperatorQuota(makeSupabase(true), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.allowed).toBe(true);
    // Sentinel large value keeps JSON serialization safe while still
    // signalling "unlimited" to the client.
    expect(q.remaining).toBe(999_999);
    expect(q.limit).toBeNull();
  });
});

describe("checkOperatorQuota — resetsAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspacePlan).mockResolvedValue("free");
    vi.mocked(getWorkspaceUsageForMonth).mockResolvedValue([]);
  });

  it("is the first of next month in UTC", async () => {
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.resetsAt.getUTCDate()).toBe(1);
    expect(q.resetsAt.getUTCHours()).toBe(0);
    expect(q.resetsAt.getUTCMinutes()).toBe(0);
    expect(q.resetsAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("checkOperatorQuota — fail-open on upstream errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspacePlan).mockResolvedValue("free");
  });

  it("returns allowed=true when the usage service throws", async () => {
    vi.mocked(getWorkspaceUsageForMonth).mockRejectedValue(
      new Error("usage table missing")
    );
    const q = await checkOperatorQuota(makeSupabase(), {
      userId: "u1",
      workspaceId: "w1",
    });
    expect(q.allowed).toBe(true);
    expect(q.used).toBe(0);
  });
});
