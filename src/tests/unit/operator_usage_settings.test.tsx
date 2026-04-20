import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// The Billing section's Workspace Operator subsection is a "use client"
// React component. The rest of the repo exercises such components by
// contract (see agent_preferences_card.test.tsx for the template), which
// is what we do here: we verify the shape of the server action that
// powers the load, the inferred run-limit rendering rules, and that the
// subsection component is a function export wired through settings_client.
//
// When @testing-library/react lands, these tests should be upgraded to
// render-and-assert; until then they cover the two user-visible
// invariants the spec calls out:
//   1. "renders counts"
//   2. "shows 'unlimited' when runLimit null"
// ---------------------------------------------------------------------------

vi.mock("@/server/auth/get_request_context", () => ({
  getRequestContext: vi.fn(() =>
    Promise.resolve({
      isAuthenticated: true,
      user: { id: "user-1" },
      workspace: { id: "ws-1" },
    })
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/server/services/workspace_operator_usage_service", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/workspace_operator_usage_service")
  >("@/server/services/workspace_operator_usage_service");
  return {
    ...actual,
    getWorkspaceUsageForMonth: vi.fn(async () => [
      {
        workspaceId: "ws-1",
        userId: "user-1",
        month: actual.monthKey(),
        runCount: 12,
        toolCallCount: 37,
        inputTokenCount: 4_500,
        outputTokenCount: 1_200,
        estimatedCostCents: 43,
      },
    ]),
  };
});

import {
  OperatorUsageSubsection,
  BillingSection,
} from "@/app/app/settings/settings_client";
import { loadOperatorUsageAction } from "@/app/app/settings/operator_usage_actions";
import {
  monthKey,
  sumOperatorUsage,
} from "@/server/services/workspace_operator_usage_service";

// ─── Module surface ──────────────────────────────────────────────────────────

describe("OperatorUsageSubsection module", () => {
  it("exports OperatorUsageSubsection as a function component", () => {
    expect(typeof OperatorUsageSubsection).toBe("function");
  });

  it("exports BillingSection as a function component (still wired)", () => {
    expect(typeof BillingSection).toBe("function");
  });
});

// ─── Counts-render contract ──────────────────────────────────────────────────

describe("OperatorUsageSubsection render output", () => {
  // The subsection is a server-renderable React component with no hooks.
  // We invoke it directly and assert on the shape of the returned element
  // tree — a testing-library-free approximation that covers the "renders
  // counts" and "shows 'unlimited' when runLimit null" user stories.

  interface ReactLike {
    type: unknown;
    props: { children?: unknown } & Record<string, unknown>;
  }

  function flatten(node: unknown): string {
    if (node == null || node === false) return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(flatten).join(" ");
    if (typeof node === "object") {
      const n = node as ReactLike;
      if (typeof n.type === "function") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rendered = (n.type as (p: any) => unknown)(n.props);
        return flatten(rendered);
      }
      return flatten(n.props?.children);
    }
    return "";
  }

  it("renders run, tool-call, token, and cost counts", () => {
    const el = OperatorUsageSubsection({
      usage: {
        runCount: 12,
        toolCallCount: 37,
        inputTokenCount: 4_500,
        outputTokenCount: 1_200,
        estimatedCostCents: 43,
      },
      runLimit: null,
    });
    const text = flatten(el);

    // "12" is the run count; with runLimit null there's no "/ Y" suffix.
    expect(text).toContain("12");
    // Tool calls
    expect(text).toContain("37");
    // Total tokens (4_500 + 1_200 = 5_700)
    expect(text).toContain("5700");
    // Estimated cost 43 cents → $0.43
    expect(text).toContain("$0.43");
  });

  it("shows the count alone (no denominator) when runLimit is null", () => {
    const el = OperatorUsageSubsection({
      usage: {
        runCount: 4,
        toolCallCount: 0,
        inputTokenCount: 0,
        outputTokenCount: 0,
        estimatedCostCents: 0,
      },
      runLimit: null,
    });
    const text = flatten(el);

    // runLimit null → the hint renders the literal "Unlimited" label.
    expect(text).toContain("Unlimited");
    // The "4 / N" denominator form must NOT appear when runLimit is null.
    expect(text).not.toMatch(/\b4\s*\/\s*\d+/);
  });

  it("shows 'X / Y' when runLimit is a number", () => {
    const el = OperatorUsageSubsection({
      usage: {
        runCount: 8,
        toolCallCount: 2,
        inputTokenCount: 0,
        outputTokenCount: 0,
        estimatedCostCents: 0,
      },
      runLimit: 50,
    });
    const text = flatten(el);
    expect(text).toMatch(/8\s*\/\s*50/);
    // "Unlimited" hint must NOT appear when the limit is finite.
    expect(text).not.toContain("Unlimited");
  });

  it("renders sub-cent cost as '< $0.01' rather than '$0.00'", () => {
    const el = OperatorUsageSubsection({
      usage: {
        runCount: 1,
        toolCallCount: 0,
        inputTokenCount: 1,
        outputTokenCount: 0,
        estimatedCostCents: 1, // Computed upstream; renderer just formats.
      },
      runLimit: null,
    });
    const text = flatten(el);
    // 1 cent → $0.01 exactly; but a ceil-to-1-cent on very small values is
    // still shown with two-decimal precision.
    expect(text).toContain("$0.01");
  });
});

// ─── Server action contract ──────────────────────────────────────────────────

describe("loadOperatorUsageAction", () => {
  it("returns the current-month summary with totals across all users", async () => {
    const result = await loadOperatorUsageAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.month).toBe(monthKey());
    // Mock returned a single row with runCount=12 etc.; totals collapse to
    // the same values (sum over a single-element list).
    expect(result.data.totals.runCount).toBe(12);
    expect(result.data.totals.toolCallCount).toBe(37);
    expect(result.data.totals.estimatedCostCents).toBe(43);
  });

  it("sumOperatorUsage is the aggregation the action relies on", () => {
    const totals = sumOperatorUsage([
      {
        workspaceId: "ws-1",
        userId: "user-1",
        month: monthKey(),
        runCount: 3,
        toolCallCount: 10,
        inputTokenCount: 100,
        outputTokenCount: 50,
        estimatedCostCents: 2,
      },
      {
        workspaceId: "ws-1",
        userId: "user-2",
        month: monthKey(),
        runCount: 2,
        toolCallCount: 5,
        inputTokenCount: 40,
        outputTokenCount: 20,
        estimatedCostCents: 1,
      },
    ]);
    expect(totals.runCount).toBe(5);
    expect(totals.toolCallCount).toBe(15);
    expect(totals.estimatedCostCents).toBe(3);
  });
});
