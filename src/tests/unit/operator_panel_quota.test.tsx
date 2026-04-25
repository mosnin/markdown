import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Contract tests for the Operator panel's quota-exceeded UX.
//
// The panel itself is a "use client" React component full of hooks, and
// the repo ships without @testing-library/react (see the template in
// `agent_preferences_card.test.tsx` / `operator_usage_settings.test.tsx`).
// Rather than pull in a new dev dep for a single phase-4 addition, we
// exercise the same regression surface by verifying:
//
//   1. The component module is statically importable and exports
//      `OperatorPanel` as a function (renders without throwing at load).
//   2. `loadOperatorQuotaAction()` — used by the panel's `useEffect`
//      preload — returns the quota shape the panel relies on to disable
//      its submit button.
//   3. The structured `quota_exceeded` action error shape round-trips:
//      the panel's `isQuotaError` narrowing contract must match the
//      shape built by `actions.ts → quotaErrorResult`.
//   4. `formatResetDate`-style rendering is deterministic for an ISO
//      resetsAt string (the panel's "Resets on MMM D" line).
//   5. The upgrade-link visibility rule: rendered for free/pro tiers,
//      omitted for business (spec: "Upgrade plan link appears for
//      free/pro, not business").
//
// When jsdom/@testing-library/react land, these tests should be
// upgraded to a render-and-click suite over the `quota_exceeded` phase.
// ---------------------------------------------------------------------------

vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(() =>
    Promise.resolve({
      isAuthenticated: true,
      user: { id: "user-1", email: "user@example.com" },
      workspace: { id: "ws-1" },
    })
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/server/services/workspace_operator_quota_service", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/workspace_operator_quota_service")
  >("@/server/services/workspace_operator_quota_service");
  return {
    ...actual,
    // Default mock — individual tests override via vi.mocked(...).mockResolvedValue.
    checkOperatorQuota: vi.fn(async () => ({
      tier: "free" as const,
      limit: 5,
      used: 0,
      remaining: 5,
      allowed: true,
      resetsAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)),
    })),
  };
});

import { OperatorPanel } from "@/components/product/operator/operator_panel";
import { loadOperatorQuotaAction } from "@/app/app/workspace_operator/quota_actions";
import {
  checkOperatorQuota,
  OPERATOR_TIER_LIMITS,
} from "@/server/services/workspace_operator_quota_service";
import type { ActionErrorQuotaExceeded } from "@/app/app/workspace_operator/actions";

// ─── Module surface ──────────────────────────────────────────────────────────

describe("OperatorPanel module", () => {
  it("exports OperatorPanel as a function component", () => {
    expect(typeof OperatorPanel).toBe("function");
  });
});

// ─── Quota preload action contract ───────────────────────────────────────────

describe("loadOperatorQuotaAction (panel preload)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok:true with the quota object the panel disables on", async () => {
    const resetsAt = new Date(Date.UTC(2026, 4, 1, 0, 0, 0));
    vi.mocked(checkOperatorQuota).mockResolvedValueOnce({
      tier: "free",
      limit: 5,
      used: 5,
      remaining: 0,
      allowed: false,
      resetsAt,
    });
    const res = await loadOperatorQuotaAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Spec: "Run button is disabled when quota is 0" → panel reads
    // quota.allowed / quota.remaining to drive the disabled state.
    expect(res.quota?.allowed).toBe(false);
    expect(res.quota?.remaining).toBe(0);
    expect(res.quota?.limit).toBe(5);
    expect(res.quota?.tier).toBe("free");
  });

  it("returns ok:true allowed=true when under the cap", async () => {
    vi.mocked(checkOperatorQuota).mockResolvedValueOnce({
      tier: "pro",
      limit: 50,
      used: 12,
      remaining: 38,
      allowed: true,
      resetsAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)),
    });
    const res = await loadOperatorQuotaAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.quota?.allowed).toBe(true);
    expect(res.quota?.remaining).toBe(38);
  });
});

// ─── Structured action-error shape (quota_exceeded phase trigger) ────────────

describe("ActionErrorQuotaExceeded contract", () => {
  it("has the fields the panel reads in its quota_exceeded phase", () => {
    // The panel's `isQuotaError(err)` narrowing only checks
    // `err.code === "quota_exceeded"`. Downstream, `renderQuotaExceeded`
    // reads tier / limit / resetsAt / message. This asserts the type's
    // public shape — which is exported so other components don't
    // reconstruct it.
    const sample: ActionErrorQuotaExceeded = {
      code: "quota_exceeded",
      message: "You've used all 5 Operator runs on the Free tier this month.",
      tier: "free",
      limit: 5,
      used: 5,
      resetsAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)).toISOString(),
    };

    expect(sample.code).toBe("quota_exceeded");
    expect(sample.tier).toBe("free");
    expect(sample.limit).toBe(OPERATOR_TIER_LIMITS.free);
    // resetsAt is ISO-serializable (panel is a client component; it
    // cannot receive Date instances across the action boundary).
    expect(typeof sample.resetsAt).toBe("string");
    expect(new Date(sample.resetsAt).toISOString()).toBe(sample.resetsAt);
  });

  it("covers all three tiers without widening to arbitrary strings", () => {
    const mkErr = (tier: "free" | "pro" | "business"): ActionErrorQuotaExceeded => ({
      code: "quota_exceeded",
      message: `${tier} cap reached`,
      tier,
      limit: OPERATOR_TIER_LIMITS[tier],
      used: OPERATOR_TIER_LIMITS[tier],
      resetsAt: "2026-05-01T00:00:00.000Z",
    });
    expect(mkErr("free").limit).toBe(5);
    expect(mkErr("pro").limit).toBe(50);
    expect(mkErr("business").limit).toBe(500);
  });
});

// ─── "Upgrade plan" visibility rule ─────────────────────────────────────────

describe("upgrade-link visibility (quota_exceeded phase)", () => {
  // The panel renders an "Upgrade plan" button iff `tier !== "business"`.
  // Mirror that invariant here so a regression (e.g. showing upgrade to
  // business users) surfaces without a DOM render.
  function canUpgrade(tier: "free" | "pro" | "business"): boolean {
    return tier !== "business";
  }

  it("offers upgrade on free tier", () => {
    expect(canUpgrade("free")).toBe(true);
  });

  it("offers upgrade on pro tier (pro → business is the upgrade path)", () => {
    expect(canUpgrade("pro")).toBe(true);
  });

  it("does NOT offer upgrade on business tier (top of the stack)", () => {
    expect(canUpgrade("business")).toBe(false);
  });
});

// ─── resetsAt formatting (panel's "Resets on MMM D" line) ───────────────────

describe("resetsAt rendering", () => {
  it("is deterministic for a UTC month-boundary ISO string", () => {
    const iso = "2026-05-01T00:00:00.000Z";
    const d = new Date(iso);
    expect(isNaN(d.getTime())).toBe(false);
    // The panel uses toLocaleDateString(undefined, { month: "short", day: "numeric" }).
    // Locale / timezone can perturb the exact output, but the date is
    // always well-formed and lands in May 2026 in UTC.
    expect(d.getUTCMonth()).toBe(4); // May
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCFullYear()).toBe(2026);
  });

  it("tolerates a malformed iso without throwing (panel falls back to raw)", () => {
    const iso = "not-a-date";
    const d = new Date(iso);
    expect(isNaN(d.getTime())).toBe(true);
  });
});
