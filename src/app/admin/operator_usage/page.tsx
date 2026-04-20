import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { monthKey } from "@/server/services/workspace_operator_usage_service";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkspaceUsageSummary {
  workspace_id: string;
  workspace_name: string;
  run_count: number;
  tool_call_count: number;
  input_token_count: number;
  output_token_count: number;
  estimated_cost_cents: number;
}

// ─── Data fetching ───────────────────────────────────────────────────────────

/**
 * Load the current month's Workspace Operator usage aggregated per
 * workspace, sorted by estimated cost descending. This is the ops rollup
 * an admin uses to spot runaway agents before they eat the budget.
 */
async function fetchOperatorUsageSummaries(): Promise<WorkspaceUsageSummary[]> {
  const adminClient = createAdminClient();
  const month = monthKey();

  const { data: usageRows, error } = await adminClient
    .from("workspace_operator_usage")
    .select(
      "workspace_id, run_count, tool_call_count, input_token_count, output_token_count, estimated_cost_cents"
    )
    .eq("month", month);

  if (error || !usageRows || usageRows.length === 0) return [];

  // Per-user rows collapse to a single per-workspace summary.
  const byWorkspace = new Map<
    string,
    Omit<WorkspaceUsageSummary, "workspace_name">
  >();
  for (const row of usageRows as Array<{
    workspace_id: string;
    run_count: number;
    tool_call_count: number;
    input_token_count: number;
    output_token_count: number;
    estimated_cost_cents: number;
  }>) {
    const existing = byWorkspace.get(row.workspace_id) ?? {
      workspace_id: row.workspace_id,
      run_count: 0,
      tool_call_count: 0,
      input_token_count: 0,
      output_token_count: 0,
      estimated_cost_cents: 0,
    };
    existing.run_count += row.run_count;
    existing.tool_call_count += row.tool_call_count;
    existing.input_token_count += row.input_token_count;
    existing.output_token_count += row.output_token_count;
    existing.estimated_cost_cents += row.estimated_cost_cents;
    byWorkspace.set(row.workspace_id, existing);
  }

  // Attach workspace names.
  const workspaceIds = Array.from(byWorkspace.keys());
  const { data: workspaces } = await adminClient
    .from("workspaces")
    .select("id, name")
    .in("id", workspaceIds);

  const nameMap = new Map(
    ((workspaces ?? []) as Array<{ id: string; name: string }>).map((w) => [
      w.id,
      w.name,
    ])
  );

  return Array.from(byWorkspace.values())
    .map((r) => ({
      ...r,
      workspace_name: nameMap.get(r.workspace_id) ?? r.workspace_id,
    }))
    .sort((a, b) => b.estimated_cost_cents - a.estimated_cost_cents);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  if (cents === 0) return "$0.00";
  const dollars = cents / 100;
  if (dollars < 0.01) return "< $0.01";
  return `$${dollars.toFixed(2)}`;
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card size="sm">
      <CardHeader className="px-5 pt-4 pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function OperatorUsagePage() {
  await requireAdmin();

  const rows = await fetchOperatorUsageSummaries();

  const totalRuns = rows.reduce((n, r) => n + r.run_count, 0);
  const totalToolCalls = rows.reduce((n, r) => n + r.tool_call_count, 0);
  const totalCostCents = rows.reduce(
    (n, r) => n + r.estimated_cost_cents,
    0
  );
  const totalTokens = rows.reduce(
    (n, r) => n + r.input_token_count + r.output_token_count,
    0
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Operator usage
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current-month Workspace Operator usage aggregated per workspace,
          sorted by estimated cost.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Workspaces" value={rows.length} />
        <StatCard label="Total runs" value={totalRuns} />
        <StatCard label="Total tool calls" value={totalToolCalls} />
        <StatCard label="Total cost" value={formatCents(totalCostCents)} />
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <p className="text-sm font-medium">No Operator activity this month</p>
          <p className="mt-1 text-xs">
            Usage rows are written by the Workspace Operator server actions.
            Kick off a run to populate this page.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {[
                  "Workspace",
                  "Runs",
                  "Tool calls",
                  "Input tokens",
                  "Output tokens",
                  "Estimated cost",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr
                  key={row.workspace_id}
                  className="bg-background transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {row.workspace_name}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {row.run_count}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {row.tool_call_count}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {row.input_token_count}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {row.output_token_count}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium text-foreground">
                    {formatCents(row.estimated_cost_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Token usage will appear once the Python/Modal agent reports it.
        Totals reset on the first day of each month (UTC).
      </p>
    </div>
  );
}

// Placeholder reference so the unused-var linter doesn't bark on types
// that exist purely for the non-exported helper shapes above.
export type { WorkspaceUsageSummary };
