import {
  Bot,
  GitFork,
  Slash,
  Sparkles,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCents,
  type UsageCategory,
  type UsageCategoryBreakdown,
} from "@/server/services/usage_summary_service";

interface UsageBreakdownTableProps {
  rows: UsageCategoryBreakdown[];
}

const CATEGORY_ICON: Record<UsageCategory, React.ElementType> = {
  operator: Bot,
  subagent: Sparkles,
  workflow: GitFork,
  inline_command: Slash,
  trigger: Zap,
};

/**
 * Static (server-rendered) breakdown of usage by category. Mirrors the
 * bordered-card aesthetic of WorkflowRow with text-xs metadata and
 * tabular-nums for the money column so the digits line up vertically.
 *
 * Cost-free categories (inline commands, triggers — see the service
 * doc-comment for why they're 0) render an em-dash so it's clear the
 * column is intentional, not missing data.
 */
export function UsageBreakdownTable({ rows }: UsageBreakdownTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-8 text-center">
        <WorkflowIcon
          className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">No usage recorded yet.</p>
      </div>
    );
  }

  const totalCost = rows.reduce((sum, r) => sum + r.costCents, 0);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Header row */}
      <div
        className={cn(
          "grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border px-4 py-2",
          "text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70"
        )}
      >
        <span>Category</span>
        <span className="text-right">Runs</span>
        <span className="text-right">Spend</span>
        <span className="w-10 text-right">%</span>
      </div>

      <ul className="flex flex-col list-none">
        {rows.map((row) => {
          const Icon = CATEGORY_ICON[row.category];
          const pct =
            totalCost > 0 ? Math.round((row.costCents / totalCost) * 100) : 0;
          return (
            <li
              key={row.category}
              className={cn(
                "grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border/40 px-4 py-2.5 last:border-b-0",
                "text-sm"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="truncate font-medium text-foreground">
                  {row.label}
                </span>
              </div>
              <span className="text-right tabular-nums text-xs text-muted-foreground">
                {row.runs.toLocaleString("en-US")}
              </span>
              <span className="text-right tabular-nums text-foreground">
                {row.costCents > 0 ? formatCents(row.costCents) : (
                  <span className="text-muted-foreground/60">—</span>
                )}
              </span>
              <span className="w-10 text-right tabular-nums text-[11px] text-muted-foreground/70">
                {row.costCents > 0 ? `${pct}%` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
