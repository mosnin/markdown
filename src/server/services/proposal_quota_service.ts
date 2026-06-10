import { type SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import {
  getWorkspacePlan,
  type WorkspacePlan,
} from "@/server/services/subscription_service";
import {
  PROPOSAL_TIER_LIMITS,
  CONNECTED_AGENT_TIER_LIMITS,
  UPGRADE_URL,
} from "@/server/domain/constants/proposal_quota";

/**
 * Write-proposal paywall — the per-tier guardrail on the core metered action
 * of the Poggle loop (agents submit write proposals; humans approve them).
 *
 * This is the ENFORCEMENT layer the paywall needs: it is called from
 * `createProposal` in write_proposal_service.ts so BOTH the MCP path
 * (`create_write_proposal`) and the in-app `/api/v1/write_proposals` path
 * are gated by a single check.
 *
 * Counting:
 *   * **Write proposals** are a per-WORKSPACE, per-billing-period bucket.
 *     The period is the current Creem subscription month when known
 *     (derived from `current_period_end`), otherwise the current UTC
 *     calendar month — matching the operator-quota month boundary so the
 *     two guardrails agree.
 *   * **Connected agents** (MCP / OAuth clients = active connections) are a
 *     live count, not period-scoped.
 *
 * Failure posture differs from the operator quota on purpose. The operator
 * quota fails *open* (guardrail). This is a *paywall*, so it fails CLOSED:
 * if we genuinely cannot determine usage we treat the workspace as over its
 * limit rather than silently giving away paid capacity. The one exception is
 * the *plan lookup* — an unknown plan defaults to `free` (the most
 * restrictive tier), which is itself the safe, paywall-preserving choice.
 */

// ─── Public surface ──────────────────────────────────────────────────────────

export interface QuotaStatus {
  tier: WorkspacePlan;
  /** Period/live cap for this tier. */
  limit: number;
  /** Count consumed so far. */
  used: number;
  /** Whether one more unit is permitted (used < limit). */
  allowed: boolean;
  /** First second (UTC) of the next billing period — for "resets on" UI. */
  resetsAt: Date;
}

/**
 * Typed over-limit result returned by `createProposal` when the workspace
 * has exhausted its plan allowance. Mirrors the contract in the task: a
 * non-throwing, discriminated failure the MCP route / proposals UI can map
 * to a 402-style "upgrade" response.
 */
export interface QuotaExceededResult {
  ok: false;
  code: "quota_exceeded";
  /** The cap that was hit. */
  limit: number;
  /** How many units are already used in the period (>= limit). */
  used: number;
  /** Where to send the user to upgrade. */
  upgradeUrl: string;
}

/** Type guard so callers can narrow a `createProposal` union result. */
export function isQuotaExceeded(value: unknown): value is QuotaExceededResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    (value as { code?: unknown }).code === "quota_exceeded"
  );
}

/** Build the typed over-limit payload from a resolved quota status. */
export function quotaExceeded(status: QuotaStatus): QuotaExceededResult {
  return {
    ok: false,
    code: "quota_exceeded",
    limit: status.limit,
    used: status.used,
    upgradeUrl: UPGRADE_URL,
  };
}

/**
 * Build the typed over-limit payload directly from a limit + used pair —
 * used by callers that enforce the cap atomically in the database (the
 * guarded insert RPCs) and so never materialise a full `QuotaStatus`. Same
 * non-throwing contract as {@link quotaExceeded}.
 */
export function quotaExceededFrom(
  limit: number,
  used: number
): QuotaExceededResult {
  return {
    ok: false,
    code: "quota_exceeded",
    limit,
    used,
    upgradeUrl: UPGRADE_URL,
  };
}

// ─── Atomic-enforcement context ────────────────────────────────────────────────

/**
 * The inputs an *atomic* write path needs to enforce the write-proposal
 * paywall itself (inside the same DB transaction that inserts), instead of
 * the racy check-then-insert that {@link checkProposalQuota} enables.
 *
 * `limit` and `periodStart` are passed straight to the guarded insert RPCs
 * (`create_write_proposal_guarded` / `create_generated_note_with_version`),
 * which take a per-workspace advisory lock, COUNT period usage, and insert
 * only when under `limit`. The TOCTOU window is thereby closed: the count and
 * the insert are serialized per workspace and happen as one unit.
 */
export interface ProposalQuotaContext {
  tier: WorkspacePlan;
  /** Per-period cap for this tier. */
  limit: number;
  /** First instant (inclusive) of the current billing period. */
  periodStart: Date;
  /** First instant of the next billing period — for "resets on" UI. */
  periodEnd: Date;
}

/**
 * Resolve the plan, per-period limit, and period window for a workspace
 * without counting usage. The counting is delegated to the guarded insert
 * RPC so it happens atomically with the insert (see {@link ProposalQuotaContext}).
 *
 * Unlike {@link checkProposalQuota} this performs no usage read and so has no
 * "fail closed on count error" branch — the DB does the count. The plan lookup
 * still defaults to the most restrictive tier (`free`) on error, preserving
 * the paywall.
 */
export async function resolveProposalQuotaContext(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ProposalQuotaContext> {
  const { tier, periodStart, periodEnd } = await loadPlanAndPeriod(
    supabase,
    workspaceId
  );
  return { tier, limit: PROPOSAL_TIER_LIMITS[tier], periodStart, periodEnd };
}

// ─── Write-proposal quota ────────────────────────────────────────────────────

/**
 * Resolve the workspace's write-proposal quota for the current billing
 * period. Pure check — performs no mutation and never throws; an infra
 * failure resolves to `allowed: false` (fail closed, see module header).
 */
export async function checkProposalQuota(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<QuotaStatus> {
  const { tier, periodStart, periodEnd } = await loadPlanAndPeriod(
    supabase,
    workspaceId
  );
  const limit = PROPOSAL_TIER_LIMITS[tier];

  let used: number;
  try {
    const { count, error } = await supabase
      .from("write_proposals")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", periodStart.toISOString());

    if (error) throw error;
    used = count ?? 0;
  } catch (err) {
    // Paywall fails CLOSED — if we can't count, assume the cap is reached
    // so paid capacity isn't given away on a flaky read.
    logger.warn(
      { err, workspaceId },
      "proposal_quota: usage count failed; failing closed"
    );
    return { tier, limit, used: limit, allowed: false, resetsAt: periodEnd };
  }

  return {
    tier,
    limit,
    used,
    allowed: used < limit,
    resetsAt: periodEnd,
  };
}

// ─── Connected-agent (connection) quota ──────────────────────────────────────

/**
 * Resolve the workspace's connected-agent quota (live count of non-revoked
 * connections). Cheap, live, not period-scoped. Same fail-closed posture.
 */
export async function checkConnectedAgentQuota(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<QuotaStatus> {
  const tier = await resolvePlan(supabase, workspaceId);
  const limit = CONNECTED_AGENT_TIER_LIMITS[tier];
  const resetsAt = firstOfNextPeriodUTC();

  let used: number;
  try {
    const { count, error } = await supabase
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .neq("status", "revoked");

    if (error) throw error;
    used = count ?? 0;
  } catch (err) {
    logger.warn(
      { err, workspaceId },
      "proposal_quota: connection count failed; failing closed"
    );
    return { tier, limit, used: limit, allowed: false, resetsAt };
  }

  return { tier, limit, used, allowed: used < limit, resetsAt };
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function resolvePlan(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspacePlan> {
  // Unknown plan → `free` (most restrictive). getWorkspacePlan already
  // collapses cancelled/absent subscriptions to free; we only guard against
  // an outright throw here.
  return getWorkspacePlan(supabase, workspaceId).catch((err) => {
    logger.warn({ err, workspaceId }, "proposal_quota: plan lookup failed; assuming free");
    return "free" as WorkspacePlan;
  });
}

/**
 * Resolve the plan plus the current billing-period window. When the
 * subscription row exposes a Creem `current_period_end` in the future, the
 * period is the [end-1month, end) interval. Otherwise we fall back to the
 * current UTC calendar month, which matches the operator-quota boundary and
 * is correct for free workspaces (which have no Creem period).
 */
async function loadPlanAndPeriod(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<{ tier: WorkspacePlan; periodStart: Date; periodEnd: Date }> {
  let plan: WorkspacePlan = "free";
  let periodEndIso: string | null = null;

  try {
    const { data } = await supabase
      .from("workspace_subscriptions")
      .select("plan, status, current_period_end")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (data) {
      const row = data as {
        plan?: string;
        status?: string;
        current_period_end?: string | null;
      };
      // Only honour Pro/Business while active — same rule as getWorkspacePlan.
      if (
        (row.plan === "pro" || row.plan === "business") &&
        row.status === "active"
      ) {
        plan = row.plan;
      }
      periodEndIso = row.current_period_end ?? null;
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    // PGRST116 / 42P01 = table missing — treat as free, no Creem period.
    if (code !== "PGRST116" && code !== "42P01") {
      logger.warn({ err, workspaceId }, "proposal_quota: subscription read failed");
    }
  }

  const end = periodEndIso ? new Date(periodEndIso) : null;
  if (end && !Number.isNaN(end.getTime()) && end.getTime() > Date.now()) {
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return { tier: plan, periodStart: start, periodEnd: end };
  }

  return {
    tier: plan,
    periodStart: firstOfMonthUTC(),
    periodEnd: firstOfNextPeriodUTC(),
  };
}

/** First second (00:00:00 UTC) of the current calendar month. */
export function firstOfMonthUTC(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
}

/** First second (00:00:00 UTC) of the next calendar month. */
export function firstOfNextPeriodUTC(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
}
