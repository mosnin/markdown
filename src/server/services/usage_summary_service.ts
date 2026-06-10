import { type SupabaseClient } from "@supabase/supabase-js";
import {
  computeEstimatedCostCents,
  FALLBACK_MODEL,
} from "@/server/services/workspace_operator_usage_service";

/**
 * Workspace Usage & Cost summary — Phase 10B.
 *
 * Aggregates spending and run counts across every paid AI surface in a
 * workspace into a single payload the dashboard renders. Pure data layer:
 * one entry point, throws on error, no caller-side `Result` envelope.
 *
 * The data is gathered from five tables, each representing a different
 * AI surface:
 *
 *   - workspace_operator_runs      — main agent (Pog) runs.
 *   - subagent_invocations         — sub-agent calls dispatched by Pog or
 *                                    inline commands.
 *   - workflow_runs                — visual workflow executions.
 *   - inline_command_invocations   — slash-command invocations from notes.
 *   - agent_trigger_runs           — scheduled / event-driven agent runs.
 *
 * Cost columns vary by table:
 *
 *   - workflow_runs has a denormalized `total_cost_cents` integer column.
 *   - workspace_operator_runs and subagent_invocations store input/output
 *     token counts; cost is derived via `computeEstimatedCostCents` using
 *     the same pricing table the billing rollup uses, so the dashboard
 *     and billing settings agree to the cent.
 *   - inline_command_invocations and agent_trigger_runs do not record
 *     spend directly — they're "shells" that delegate to a sub-agent or
 *     operator run respectively. We surface the run/invocation count for
 *     visibility, but cost contribution is 0 (the underlying sub-agent /
 *     operator row is what carries the bill, and that row is counted in
 *     its own category — no double-counting).
 *
 * Reads use the user-scoped Supabase client; RLS enforces the workspace
 * boundary on every table.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type UsageCategory =
  | "operator"
  | "subagent"
  | "workflow"
  | "inline_command"
  | "trigger";

export interface UsageCategoryBreakdown {
  category: UsageCategory;
  label: string;
  runs: number;
  costCents: number;
}

export interface UsageRecentRun {
  id: string;
  category: UsageCategory;
  /** Human-readable label (workflow name, skill name, command id, etc). */
  label: string;
  startedAt: string;
  status: string;
  costCents: number;
}

export interface UsageDailySpend {
  /** YYYY-MM-DD (UTC). */
  date: string;
  costCents: number;
  runs: number;
}

export interface UsageSummary {
  totalCostCents: number;
  totalRuns: number;
  byCategory: UsageCategoryBreakdown[];
  recentRuns: UsageRecentRun[];
  dailySpend: UsageDailySpend[];
}

export interface GetWorkspaceUsageSummaryOptions {
  /** Number of recent runs to include across all categories. Defaults to 20. */
  recentLimit?: number;
  /** Number of trailing days of spend to bucket. Defaults to 30. */
  dailyDays?: number;
}

// ─── Row shapes (lightweight, only the columns we read) ───────────────────────

interface OperatorRunRow {
  id: string;
  status: string;
  prompt: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

interface SubagentRow {
  id: string;
  status: string;
  task: string;
  input_tokens: number;
  output_tokens: number;
  started_at: string;
  skill_id: string | null;
}

interface WorkflowRunRow {
  id: string;
  status: string;
  workflow_id: string;
  total_cost_cents: number;
  started_at: string;
}

interface InlineCommandRow {
  id: string;
  status: string;
  command_id: string;
  created_at: string;
}

interface TriggerRunRow {
  id: string;
  status: string;
  trigger_id: string;
  started_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** YYYY-MM-DD bucket key for an ISO timestamp, in UTC. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO of the start (UTC midnight) of `daysAgo` days before today. */
function startOfDayUtc(daysAgo: number): Date {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

/** Compute operator/subagent cost from token counts using the shared model. */
function tokenCost(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  return computeEstimatedCostCents(
    model ?? FALLBACK_MODEL,
    inputTokens,
    outputTokens
  );
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function getWorkspaceUsageSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: GetWorkspaceUsageSummaryOptions = {}
): Promise<UsageSummary> {
  const recentLimit = opts.recentLimit ?? 20;
  const dailyDays = opts.dailyDays ?? 30;
  const dailyWindowStart = startOfDayUtc(dailyDays - 1).toISOString();

  // Fire all aggregation queries in parallel. Each table contributes:
  //   1. A "totals + window rows" fetch for breakdown + dailySpend.
  //   2. A "last N" fetch for recent activity.
  //
  // We deliberately fetch raw rows (capped) for the daily spend window
  // rather than running a SQL date_trunc aggregation — keeps us off RPC
  // and the row volumes (≤ 30 days × handful of runs/day) are tiny.
  const [
    operatorWindow,
    operatorRecent,
    subagentWindow,
    subagentRecent,
    workflowWindow,
    workflowRecent,
    inlineWindow,
    inlineRecent,
    triggerWindow,
    triggerRecent,
    workflowsForLabels,
    skillsForLabels,
  ] = await Promise.all([
    supabase
      .from("workspace_operator_runs")
      .select("id, status, prompt, model, input_tokens, output_tokens, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", dailyWindowStart)
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("workspace_operator_runs")
      .select("id, status, prompt, model, input_tokens, output_tokens, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("subagent_invocations")
      .select("id, status, task, input_tokens, output_tokens, started_at, skill_id")
      .eq("workspace_id", workspaceId)
      .gte("started_at", dailyWindowStart)
      .order("started_at", { ascending: false })
      .limit(2000),
    supabase
      .from("subagent_invocations")
      .select("id, status, task, input_tokens, output_tokens, started_at, skill_id")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("workflow_runs")
      .select("id, status, workflow_id, total_cost_cents, started_at")
      .eq("workspace_id", workspaceId)
      .gte("started_at", dailyWindowStart)
      .order("started_at", { ascending: false })
      .limit(2000),
    supabase
      .from("workflow_runs")
      .select("id, status, workflow_id, total_cost_cents, started_at")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("inline_command_invocations")
      .select("id, status, command_id, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", dailyWindowStart)
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("inline_command_invocations")
      .select("id, status, command_id, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("agent_trigger_runs")
      .select("id, status, trigger_id, started_at")
      .eq("workspace_id", workspaceId)
      .gte("started_at", dailyWindowStart)
      .order("started_at", { ascending: false })
      .limit(2000),
    supabase
      .from("agent_trigger_runs")
      .select("id, status, trigger_id, started_at")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("workflows")
      .select("id, name")
      .eq("workspace_id", workspaceId),
    supabase
      .from("skills")
      .select("id, name")
      .eq("workspace_id", workspaceId),
  ]);

  // RLS or transient errors throw — the page wraps this in error.tsx.
  // We accept "table does not exist" gracefully (some envs may lag a
  // migration), but otherwise surface the message.
  function check(label: string, err: { message?: string } | null | undefined) {
    if (!err) return;
    throw new Error(`usage_summary: ${label} query failed: ${err.message ?? "unknown"}`);
  }
  check("operator window", operatorWindow.error);
  check("operator recent", operatorRecent.error);
  check("subagent window", subagentWindow.error);
  check("subagent recent", subagentRecent.error);
  check("workflow window", workflowWindow.error);
  check("workflow recent", workflowRecent.error);
  check("inline window", inlineWindow.error);
  check("inline recent", inlineRecent.error);
  check("trigger window", triggerWindow.error);
  check("trigger recent", triggerRecent.error);
  check("workflow labels", workflowsForLabels.error);
  check("skill labels", skillsForLabels.error);

  const operatorRows = (operatorWindow.data ?? []) as OperatorRunRow[];
  const subagentRows = (subagentWindow.data ?? []) as SubagentRow[];
  const workflowRows = (workflowWindow.data ?? []) as WorkflowRunRow[];
  const inlineRows = (inlineWindow.data ?? []) as InlineCommandRow[];
  const triggerRows = (triggerWindow.data ?? []) as TriggerRunRow[];

  const workflowName = new Map<string, string>(
    ((workflowsForLabels.data ?? []) as Array<{ id: string; name: string }>).map(
      (w) => [w.id, w.name]
    )
  );
  const skillName = new Map<string, string>(
    ((skillsForLabels.data ?? []) as Array<{ id: string; name: string }>).map(
      (s) => [s.id, s.name]
    )
  );

  // ── Per-row cost derivation ────────────────────────────────────────────
  const operatorCosts = operatorRows.map((r) =>
    tokenCost(r.model, r.input_tokens, r.output_tokens)
  );
  const subagentCosts = subagentRows.map((r) =>
    // Sub-agents don't store the model id today — fall back to the
    // shared FALLBACK_MODEL pricing. Once the column lands the read
    // here updates without changing the dashboard.
    tokenCost(null, r.input_tokens, r.output_tokens)
  );
  const workflowCosts = workflowRows.map((r) => r.total_cost_cents ?? 0);

  // ── byCategory ─────────────────────────────────────────────────────────
  const byCategory: UsageCategoryBreakdown[] = [
    {
      category: "operator",
      label: "Pog (operator)",
      runs: operatorRows.length,
      costCents: operatorCosts.reduce((a, b) => a + b, 0),
    },
    {
      category: "subagent",
      label: "Sub-agents",
      runs: subagentRows.length,
      costCents: subagentCosts.reduce((a, b) => a + b, 0),
    },
    {
      category: "workflow",
      label: "Workflows",
      runs: workflowRows.length,
      costCents: workflowCosts.reduce((a, b) => a + b, 0),
    },
    {
      category: "inline_command",
      // Cost for inline commands flows through the linked sub-agent row
      // (counted under "Sub-agents"), so the column here is 0 by design.
      label: "Inline commands",
      runs: inlineRows.length,
      costCents: 0,
    },
    {
      category: "trigger",
      // Same story: triggers fire operator runs, which are billed in
      // their own category. We surface the run count for awareness.
      label: "Triggers",
      runs: triggerRows.length,
      costCents: 0,
    },
  ];

  const totalCostCents = byCategory.reduce((sum, c) => sum + c.costCents, 0);
  const totalRuns = byCategory.reduce((sum, c) => sum + c.runs, 0);

  // ── dailySpend (last `dailyDays` days, including days with zero spend) ──
  const dayBuckets = new Map<string, { costCents: number; runs: number }>();
  for (let i = dailyDays - 1; i >= 0; i--) {
    const key = dayKey(startOfDayUtc(i).toISOString());
    dayBuckets.set(key, { costCents: 0, runs: 0 });
  }
  function pushDay(iso: string, cents: number) {
    const key = dayKey(iso);
    const bucket = dayBuckets.get(key);
    if (!bucket) return; // Outside the window — drop.
    bucket.costCents += cents;
    bucket.runs += 1;
  }
  operatorRows.forEach((r, i) => pushDay(r.created_at, operatorCosts[i]));
  subagentRows.forEach((r, i) => pushDay(r.started_at, subagentCosts[i]));
  workflowRows.forEach((r, i) => pushDay(r.started_at, workflowCosts[i]));
  inlineRows.forEach((r) => pushDay(r.created_at, 0));
  triggerRows.forEach((r) => pushDay(r.started_at, 0));

  const dailySpend: UsageDailySpend[] = Array.from(dayBuckets.entries())
    .map(([date, v]) => ({ date, costCents: v.costCents, runs: v.runs }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── recentRuns: merge across categories then sort + slice ──────────────
  const recents: UsageRecentRun[] = [];

  for (const r of (operatorRecent.data ?? []) as OperatorRunRow[]) {
    recents.push({
      id: r.id,
      category: "operator",
      label: truncate(r.prompt, 80) || "Operator run",
      startedAt: r.created_at,
      status: r.status,
      costCents: tokenCost(r.model, r.input_tokens, r.output_tokens),
    });
  }
  for (const r of (subagentRecent.data ?? []) as SubagentRow[]) {
    const name = r.skill_id ? skillName.get(r.skill_id) : null;
    recents.push({
      id: r.id,
      category: "subagent",
      label: name ?? truncate(r.task, 80) ?? "Sub-agent",
      startedAt: r.started_at,
      status: r.status,
      costCents: tokenCost(null, r.input_tokens, r.output_tokens),
    });
  }
  for (const r of (workflowRecent.data ?? []) as WorkflowRunRow[]) {
    recents.push({
      id: r.id,
      category: "workflow",
      label: workflowName.get(r.workflow_id) ?? "Workflow",
      startedAt: r.started_at,
      status: r.status,
      costCents: r.total_cost_cents ?? 0,
    });
  }
  for (const r of (inlineRecent.data ?? []) as InlineCommandRow[]) {
    recents.push({
      id: r.id,
      category: "inline_command",
      label: r.command_id,
      startedAt: r.created_at,
      status: r.status,
      costCents: 0,
    });
  }
  for (const r of (triggerRecent.data ?? []) as TriggerRunRow[]) {
    recents.push({
      id: r.id,
      category: "trigger",
      label: "Triggered run",
      startedAt: r.started_at,
      status: r.status,
      costCents: 0,
    });
  }

  recents.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const recentRuns = recents.slice(0, recentLimit);

  return {
    totalCostCents,
    totalRuns,
    byCategory,
    recentRuns,
    dailySpend,
  };
}

// ─── Display helpers (re-exported for the page / components) ──────────────────

/** Format an integer cent value as "$X.XX". Negative values are clamped to 0. */
export function formatCents(cents: number): string {
  const safe = Math.max(0, Math.round(cents));
  return `$${(safe / 100).toFixed(2)}`;
}

/** Sum the dailySpend rows that fall in the current calendar month (UTC). */
export function sumThisMonth(daily: UsageDailySpend[]): number {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return daily
    .filter((d) => d.date.startsWith(ym))
    .reduce((sum, d) => sum + d.costCents, 0);
}
