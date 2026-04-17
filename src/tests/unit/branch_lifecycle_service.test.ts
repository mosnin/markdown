import { describe, it, expect, vi, beforeEach } from "vitest";

// Hermetic: the service dynamic-imports several peers. Stub them so the
// unit test doesn't pull live Supabase adapters or the audit repo.
vi.mock("@/server/repositories/audit_event_repository", () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/pending_op_service", () => ({
  dropAllPendingOpsForBranch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/box_branch_metadata_service", () => ({
  dropAllBoxOverlaysForBranch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/folder_branch_service", () => ({
  dropAllFolderOverridesForBranch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/server/services/placement_branch_service", () => ({
  dropAllPlacementOverridesForBranch: vi.fn().mockResolvedValue(undefined),
}));
// branch_service is dynamic-imported for discardDraftBranch; keep the
// rest of the module intact (type re-exports etc.).
vi.mock("@/server/services/branch_service", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, discardDraftBranch: vi.fn().mockResolvedValue(undefined) };
});

import {
  DEFAULT_AUTO_DISCARD_AFTER_DAYS,
  DEFAULT_WARN_AFTER_IDLE_DAYS,
  autoDiscardExpiredBranches,
  getRetentionPolicy,
  listStaleBranches,
  setRetentionPolicy,
  touchBranchActivity,
  warnStaleBranches,
} from "@/server/services/branch_lifecycle_service";
import type { DraftBranch } from "@/server/services/branch_service";

/**
 * Unit tests for `branch_lifecycle_service`.
 *
 * Five surfaces:
 *
 *   - Policy CRUD (getRetentionPolicy / setRetentionPolicy)
 *   - Activity touch (touchBranchActivity)
 *   - Stale detection (listStaleBranches)
 *   - Warn + auto-discard loops
 *
 * Each describe-block exercises one invariant against an inline
 * Supabase mock; the mock captures every `(table, op, filters, args)`
 * tuple so assertions can pin down both the shape and the scope.
 */

const WS = "ws-1";
const ACTOR = "user-1";
const DAY_MS = 24 * 60 * 60 * 1000;

interface Recorded {
  table: string;
  op: "select" | "update" | "upsert" | "delete" | "insert";
  filters: Record<string, unknown>;
  args?: Record<string, unknown>;
}

function baseBranch(overrides: Partial<DraftBranch> = {}): DraftBranch {
  return {
    id: "b-1",
    workspace_id: WS,
    name: "B",
    description: null,
    base_change_set_id: null,
    created_by: ACTOR,
    status: "open",
    review_status: "draft",
    created_at: new Date().toISOString(),
    promoted_at: null,
    discarded_at: null,
    rolled_back_at: null,
    rollback_change_set_id: null,
    authored_by_connection_id: null,
    authored_by_client_id: null,
    last_activity_at: new Date().toISOString(),
    last_warned_at: null,
    warning_count: 0,
    ...overrides,
  } as DraftBranch;
}

function makeSupabase(responses: {
  policies?: Record<string, unknown> | null;
  branches?: DraftBranch[];
}) {
  const calls: Recorded[] = [];

  function builder(table: string) {
    let op: Recorded["op"] = "select";
    const filters: Record<string, unknown> = {};
    let args: Record<string, unknown> | undefined;

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return b;
    };
    b.is = (col: string, val: unknown) => {
      filters[col] = val;
      return b;
    };
    b.in = (col: string, val: unknown) => {
      filters[col] = val;
      return b;
    };
    b.order = () => b;
    b.upsert = (payload: Record<string, unknown>, opts?: unknown) => {
      op = "upsert";
      args = { payload, opts };
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      op = "update";
      args = { payload };
      return b;
    };
    b.insert = (payload: Record<string, unknown>) => {
      op = "insert";
      args = { payload };
      return b;
    };
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, filters, args });
      if (op === "upsert") {
        return { data: args?.payload ?? null, error: null };
      }
      return { data: null, error: null };
    };
    b.maybeSingle = async () => {
      calls.push({ table, op, filters, args });
      if (table === "workspace_branch_retention_policies") {
        return { data: responses.policies ?? null, error: null };
      }
      return { data: null, error: null };
    };
    b.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      calls.push({ table, op, filters, args });
      if (table === "draft_branches" && op === "select") {
        resolve({ data: (responses.branches ?? []) as unknown[], error: null });
      } else {
        resolve({ data: [], error: null });
      }
    };
    return b;
  }

  return {
    supabase: { from: (t: string) => builder(t) } as never,
    calls,
  };
}

beforeEach(() => vi.clearAllMocks());

// ─── getRetentionPolicy ──────────────────────────────────────────────────────

describe("getRetentionPolicy", () => {
  it("returns a disabled default when no row exists", async () => {
    const { supabase } = makeSupabase({ policies: null });
    const p = await getRetentionPolicy(supabase, WS);
    expect(p.enabled).toBe(false);
    expect(p.warn_after_idle_days).toBe(DEFAULT_WARN_AFTER_IDLE_DAYS);
    expect(p.auto_discard_after_days).toBe(DEFAULT_AUTO_DISCARD_AFTER_DAYS);
    expect(p.workspace_id).toBe(WS);
  });

  it("returns the stored row when present", async () => {
    const { supabase } = makeSupabase({
      policies: {
        workspace_id: WS,
        enabled: true,
        warn_after_idle_days: 10,
        auto_discard_after_days: 20,
        updated_by: ACTOR,
        updated_at: null,
        created_at: null,
      },
    });
    const p = await getRetentionPolicy(supabase, WS);
    expect(p.enabled).toBe(true);
    expect(p.warn_after_idle_days).toBe(10);
    expect(p.auto_discard_after_days).toBe(20);
  });
});

// ─── setRetentionPolicy ──────────────────────────────────────────────────────

describe("setRetentionPolicy", () => {
  it("rejects auto < warn", async () => {
    const { supabase } = makeSupabase({ policies: null });
    await expect(
      setRetentionPolicy(supabase, WS, ACTOR, {
        enabled: true,
        warn_after_idle_days: 30,
        auto_discard_after_days: 10,
      })
    ).rejects.toThrow(/>= warn_after_idle_days/);
  });

  it("rejects non-positive days", async () => {
    const { supabase } = makeSupabase({ policies: null });
    await expect(
      setRetentionPolicy(supabase, WS, ACTOR, { warn_after_idle_days: 0 })
    ).rejects.toThrow(/positive/);
  });

  it("upserts on workspace_id with merged patch + actor stamp", async () => {
    const { supabase, calls } = makeSupabase({ policies: null });
    await setRetentionPolicy(supabase, WS, ACTOR, {
      enabled: true,
      warn_after_idle_days: 15,
      auto_discard_after_days: 30,
    });
    const up = calls.find(
      (c) => c.op === "upsert" && c.table === "workspace_branch_retention_policies"
    );
    expect(up).toBeTruthy();
    const args = up!.args as { payload: Record<string, unknown>; opts: { onConflict: string } };
    expect(args.payload).toMatchObject({
      workspace_id: WS,
      enabled: true,
      warn_after_idle_days: 15,
      auto_discard_after_days: 30,
      updated_by: ACTOR,
    });
    expect(args.opts.onConflict).toBe("workspace_id");
  });
});

// ─── touchBranchActivity ─────────────────────────────────────────────────────

describe("touchBranchActivity", () => {
  it("updates last_activity_at scoped to the branch and status=open", async () => {
    const { supabase, calls } = makeSupabase({});
    await touchBranchActivity(supabase, "b-xyz", ACTOR);
    const upd = calls.find((c) => c.op === "update" && c.table === "draft_branches");
    expect(upd).toBeTruthy();
    expect(upd!.filters.id).toBe("b-xyz");
    expect(upd!.filters.status).toBe("open");
    const payload = (upd!.args as { payload: Record<string, unknown> }).payload;
    expect(typeof payload.last_activity_at).toBe("string");
  });
});

// ─── listStaleBranches ───────────────────────────────────────────────────────

describe("listStaleBranches", () => {
  it("filters by the idleDays cutoff and sorts most-stale first", async () => {
    const now = Date.now();
    const fresh = baseBranch({
      id: "b-fresh",
      last_activity_at: new Date(now - 1 * DAY_MS).toISOString(),
    });
    const stale10 = baseBranch({
      id: "b-10",
      last_activity_at: new Date(now - 10 * DAY_MS).toISOString(),
    });
    const stale20 = baseBranch({
      id: "b-20",
      last_activity_at: new Date(now - 20 * DAY_MS).toISOString(),
    });
    const { supabase } = makeSupabase({ branches: [fresh, stale10, stale20] });
    const rows = await listStaleBranches(supabase, WS, { idleDays: 7 });
    expect(rows.map((r) => r.branch.id)).toEqual(["b-20", "b-10"]);
    expect(rows[0].daysIdle).toBeGreaterThanOrEqual(19);
    expect(rows[1].daysIdle).toBeGreaterThanOrEqual(9);
  });

  it("falls back to created_at when last_activity_at is null", async () => {
    const now = Date.now();
    const b = baseBranch({
      id: "b-null",
      last_activity_at: null,
      created_at: new Date(now - 15 * DAY_MS).toISOString(),
    });
    const { supabase } = makeSupabase({ branches: [b] });
    const rows = await listStaleBranches(supabase, WS, { idleDays: 7 });
    expect(rows).toHaveLength(1);
    expect(rows[0].daysIdle).toBeGreaterThanOrEqual(14);
  });
});

// ─── warnStaleBranches ───────────────────────────────────────────────────────

describe("warnStaleBranches", () => {
  it("returns 0 when policy is disabled", async () => {
    const { supabase } = makeSupabase({
      policies: {
        workspace_id: WS,
        enabled: false,
        warn_after_idle_days: 5,
        auto_discard_after_days: 10,
        updated_by: null,
        updated_at: null,
        created_at: null,
      },
    });
    const n = await warnStaleBranches(supabase, WS);
    expect(n).toBe(0);
  });

  it("increments warning_count + stamps last_warned_at for new warnings", async () => {
    const now = Date.now();
    const staleB = baseBranch({
      id: "b-stale",
      last_activity_at: new Date(now - 20 * DAY_MS).toISOString(),
      warning_count: 0,
      last_warned_at: null,
    });
    const { supabase, calls } = makeSupabase({
      policies: {
        workspace_id: WS,
        enabled: true,
        warn_after_idle_days: 5,
        auto_discard_after_days: 30,
        updated_by: null,
        updated_at: null,
        created_at: null,
      },
      branches: [staleB],
    });
    const n = await warnStaleBranches(supabase, WS);
    expect(n).toBe(1);
    const upd = calls.find(
      (c) => c.op === "update" && c.table === "draft_branches" && c.filters.id === "b-stale"
    );
    expect(upd).toBeTruthy();
    const payload = (upd!.args as { payload: Record<string, unknown> }).payload;
    expect(payload.warning_count).toBe(1);
    expect(typeof payload.last_warned_at).toBe("string");
  });

  it("skips branches already warned within the cooldown window", async () => {
    const now = Date.now();
    const recent = baseBranch({
      id: "b-recent",
      last_activity_at: new Date(now - 20 * DAY_MS).toISOString(),
      last_warned_at: new Date(now - 1 * DAY_MS).toISOString(),
      warning_count: 1,
    });
    const { supabase, calls } = makeSupabase({
      policies: {
        workspace_id: WS,
        enabled: true,
        warn_after_idle_days: 15,
        auto_discard_after_days: 30,
        updated_by: null,
        updated_at: null,
        created_at: null,
      },
      branches: [recent],
    });
    const n = await warnStaleBranches(supabase, WS);
    expect(n).toBe(0);
    const upd = calls.find(
      (c) => c.op === "update" && c.table === "draft_branches" && c.filters.id === "b-recent"
    );
    expect(upd).toBeUndefined();
  });
});

// ─── autoDiscardExpiredBranches ──────────────────────────────────────────────

describe("autoDiscardExpiredBranches", () => {
  it("skips branches without a prior warning", async () => {
    const now = Date.now();
    const neverWarned = baseBranch({
      id: "b-nowarn",
      last_activity_at: new Date(now - 100 * DAY_MS).toISOString(),
      warning_count: 0,
      last_warned_at: null,
    });
    const { supabase } = makeSupabase({
      policies: {
        workspace_id: WS,
        enabled: true,
        warn_after_idle_days: 30,
        auto_discard_after_days: 60,
        updated_by: null,
        updated_at: null,
        created_at: null,
      },
      branches: [neverWarned],
    });
    const n = await autoDiscardExpiredBranches(supabase, WS);
    expect(n).toBe(0);
  });

  it("discards branches past the auto threshold with at least one warning", async () => {
    const now = Date.now();
    const warned = baseBranch({
      id: "b-warn",
      last_activity_at: new Date(now - 100 * DAY_MS).toISOString(),
      warning_count: 1,
      last_warned_at: new Date(now - 40 * DAY_MS).toISOString(),
    });
    const { supabase } = makeSupabase({
      policies: {
        workspace_id: WS,
        enabled: true,
        warn_after_idle_days: 30,
        auto_discard_after_days: 60,
        updated_by: null,
        updated_at: null,
        created_at: null,
      },
      branches: [warned],
    });
    const n = await autoDiscardExpiredBranches(supabase, WS);
    expect(n).toBe(1);
  });

  it("returns 0 when policy is disabled", async () => {
    const { supabase } = makeSupabase({
      policies: {
        workspace_id: WS,
        enabled: false,
        warn_after_idle_days: 30,
        auto_discard_after_days: 60,
        updated_by: null,
        updated_at: null,
        created_at: null,
      },
    });
    const n = await autoDiscardExpiredBranches(supabase, WS);
    expect(n).toBe(0);
  });

  it("skips branches with review_status !== 'draft'", async () => {
    const now = Date.now();
    for (const reviewStatus of ["review_requested", "approved", "changes_requested"] as const) {
      const branch = baseBranch({
        id: `b-review-${reviewStatus}`,
        last_activity_at: new Date(now - 100 * DAY_MS).toISOString(),
        warning_count: 2,
        last_warned_at: new Date(now - 40 * DAY_MS).toISOString(),
        review_status: reviewStatus,
      });
      const { supabase } = makeSupabase({
        policies: {
          workspace_id: WS,
          enabled: true,
          warn_after_idle_days: 30,
          auto_discard_after_days: 60,
          updated_by: null,
          updated_at: null,
          created_at: null,
        },
        branches: [branch],
      });
      const n = await autoDiscardExpiredBranches(supabase, WS);
      expect(n).toBe(0);
    }
  });
});

// ─── Action-level admin gate ─────────────────────────────────────────────────

describe("updateRetentionPolicyAction (admin gate)", () => {
  it("rejects non-admins via the action wrapper", async () => {
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/server/auth/require_role", async () => {
      const actual = await vi.importActual<
        typeof import("@/server/auth/require_role")
      >("@/server/auth/require_role");
      return {
        ...actual,
        requireAdminRoleResult: vi.fn().mockResolvedValue({
          ok: false,
          error: "Only admins can perform this action.",
        }),
      };
    });
    const { updateRetentionPolicyAction } = await import(
      "@/app/app/settings/workspace/branch_retention/actions"
    );
    const res = await updateRetentionPolicyAction({ enabled: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/admins/i);
    vi.doUnmock("@/server/auth/require_role");
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("next/cache");
  });
});
