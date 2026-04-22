import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentMonthSpendCents } from "@/server/repositories/web_tool_usage_repository";

const FALLBACK_BUDGET_CENTS = 500;

export interface WebBudgetCheck {
  allowed: boolean;
  current_cents: number;
  budget_cents: number;
  /** When exhausted, how far over the budget we are. 0 otherwise. */
  overage_cents: number;
}

/**
 * Check whether the workspace has budget left for a web-tool call of the
 * given estimated cost. Returns allowed=false when current spend + cost
 * would exceed the workspace budget. Callers MUST short-circuit with 402
 * when allowed is false.
 *
 * Budget resolution:
 *   1. workspaces.web_tool_budget_cents (per-workspace override)
 *   2. WEB_TOOL_DEFAULT_BUDGET_CENTS env var (global default)
 *   3. Fallback constant 500 ($5/mo)
 */
export async function checkWebBudget(
  supabase: SupabaseClient,
  workspaceId: string,
  estimatedCostCents: number
): Promise<WebBudgetCheck> {
  const budget_cents = await resolveBudgetCents(supabase, workspaceId);
  const current_cents = await getCurrentMonthSpendCents(supabase, workspaceId);
  const projected = current_cents + estimatedCostCents;
  const allowed = projected <= budget_cents;
  const overage_cents = Math.max(0, projected - budget_cents);
  return { allowed, current_cents, budget_cents, overage_cents };
}

/**
 * Short-circuit variant for routes: returns a NextResponse 402 when
 * blocked, null when allowed. Handler continues when null.
 */
export async function enforceWebBudget(
  supabase: SupabaseClient,
  workspaceId: string,
  estimatedCostCents: number
): Promise<Response | null> {
  const check = await checkWebBudget(supabase, workspaceId, estimatedCostCents);
  if (!check.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "web_budget_exhausted",
        current_cents: check.current_cents,
        budget_cents: check.budget_cents,
      },
      { status: 402 }
    );
  }
  return null;
}

async function resolveBudgetCents(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("web_tool_budget_cents")
    .eq("id", workspaceId)
    .single();
  if (!error && data) {
    const override = (data as { web_tool_budget_cents?: number | null })
      .web_tool_budget_cents;
    if (typeof override === "number") return override;
  }

  const envVal = process.env.WEB_TOOL_DEFAULT_BUDGET_CENTS;
  if (envVal) {
    const parsed = Number.parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  return FALLBACK_BUDGET_CENTS;
}
