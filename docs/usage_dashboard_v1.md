# Usage & Cost Dashboard — v1

## Overview

The `/app/usage` route surfaces a single per-workspace view of AI spend and
activity. The page (`src/app/app/usage/page.tsx`) is a server component that
renders:

- Three stat cards: **Total spend** (last 30 days), **Total runs** (across all
  categories), and **This month** (calendar-month UTC spend, accent tile).
- A **Daily spend** bar chart (30-day sparkline, inclusive of zero days).
- A **By category** breakdown table: category, runs, spend, % of total.
- A **Recent activity** list merging the most recent runs across every
  category (up to 20 rows, default `recentLimit`).

All data is fetched synchronously on the server at render time; there is no
client-side fetching and no chart library.

## Data source

The page calls a single entry point:

```ts
getWorkspaceUsageSummary(supabase, ctx.workspace.id): Promise<UsageSummary>
```

defined in `src/server/services/usage_summary_service.ts`. The return type is:

```ts
interface UsageSummary {
  totalCostCents: number;
  totalRuns: number;
  byCategory: UsageCategoryBreakdown[];
  recentRuns: UsageRecentRun[];
  dailySpend: UsageDailySpend[];
}
```

### Field semantics

- **`totalCostCents`** — Integer cents. Computed as the sum of the
  `costCents` column of every `byCategory` row, i.e. only the categories that
  carry cost (operator + subagent + workflow). Inline commands and triggers
  contribute `0` by design.
- **`totalRuns`** — Sum of the `runs` column across every category, including
  `inline_command` and `trigger`. So the run count can legitimately exceed
  what you'd infer from `totalCostCents / avg-cost-per-run`.
- **`byCategory`** — One `UsageCategoryBreakdown` row per `UsageCategory`, in
  the fixed order the service emits them (operator, subagent, workflow,
  inline_command, trigger). Each row exposes `{ category, label, runs,
  costCents }`.
- **`recentRuns`** — Up to `recentLimit` (default 20) `UsageRecentRun` rows,
  merged from the "last 5" fetch of each category, sorted by `startedAt`
  descending. Each row carries `{ id, category, label, startedAt, status,
  costCents }`. The `label` is resolved to a human-readable value: operator
  prompts are truncated to 80 chars, sub-agents prefer the linked
  `skill.name`, workflows prefer the linked `workflow.name`, inline commands
  surface the raw `command_id`, and triggers use the literal string
  `"Triggered run"`.
- **`dailySpend`** — 30 entries of `{ date: "YYYY-MM-DD" (UTC), costCents,
  runs }`, sorted ascending by date. Always exactly `dailyDays` entries
  (default 30) including days with zero activity.

## Source tables

The service fires 12 parallel Supabase queries — for each of the five source
tables it runs a **window** query (last 30 days, limit 2000, used for
breakdown + daily buckets) and a **recent** query (last 5, used for the
activity feed) — plus two label lookup tables.

| Table                          | Cost column                  | Counted how                                       |
| ------------------------------ | ---------------------------- | ------------------------------------------------- |
| `workspace_operator_runs`      | derived from `input_tokens` + `output_tokens` via `computeEstimatedCostCents(model, ...)` | run-counted **and** cost-summed                   |
| `subagent_invocations`         | derived from `input_tokens` + `output_tokens` (model falls back to `FALLBACK_MODEL` — no `model` column today) | run-counted **and** cost-summed                   |
| `workflow_runs`                | `total_cost_cents` (denormalized integer) | run-counted **and** cost-summed                   |
| `inline_command_invocations`   | none — intentionally `costCents: 0` | run-counted only                                  |
| `agent_trigger_runs`           | none — intentionally `costCents: 0` | run-counted only                                  |
| `workflows`                    | n/a (label lookup)           | not counted                                       |
| `skills`                       | n/a (label lookup)           | not counted                                       |

### Why some tables are `costCents: 0` (no double-count rule)

Quoted from the service doc comment:

> inline_command_invocations and agent_trigger_runs do not record spend
> directly — they're "shells" that delegate to a sub-agent or operator run
> respectively. We surface the run/invocation count for visibility, but cost
> contribution is 0 (the underlying sub-agent / operator row is what carries
> the bill, and that row is counted in its own category — no double-counting).

Per-row confirmation inside `byCategory`:

> // Cost for inline commands flows through the linked sub-agent row
> // (counted under "Sub-agents"), so the column here is 0 by design.

> // Same story: triggers fire operator runs, which are billed in
> // their own category. We surface the run count for awareness.

## Category taxonomy

`UsageCategory` is a string union of exactly:

| `category`       | `label` (from service) | Origin table                   |
| ---------------- | ---------------------- | ------------------------------ |
| `operator`       | `Pog (operator)`       | `workspace_operator_runs`      |
| `subagent`       | `Sub-agents`           | `subagent_invocations`         |
| `workflow`       | `Workflows`            | `workflow_runs`                |
| `inline_command` | `Inline commands`      | `inline_command_invocations`   |
| `trigger`        | `Triggers`             | `agent_trigger_runs`           |

Note the page displays the operator label as `"Pog"` in the recent-runs
pills (via `CATEGORY_META` in `page.tsx`) while the breakdown table shows
`"Pog (operator)"` from the service.

## Daily bucketing

- **Window**: `dailyDays - 1` days in the past up to (and including) today,
  giving `dailyDays` buckets. Default `dailyDays = 30`.
- **Bucket key**: `dayKey(iso)` — `YYYY-MM-DD` computed from `getUTCFullYear`
  / `getUTCMonth` / `getUTCDate`. All bucketing is **UTC**, never local.
- **Gap handling**: The map is pre-seeded with every day in the window set
  to `{ costCents: 0, runs: 0 }` **before** any rows are pushed, so empty
  days still appear as zero-height bars rather than being dropped.
- **Overflow**: `pushDay` drops rows whose `dayKey` is not in the pre-seeded
  map — this only happens if a query returns a row outside the window, which
  the `.gte(...)` filter already prevents in practice.
- **Inline-command and trigger rows** push with `cents = 0`, so they bump
  the per-day `runs` counter but not the cost.

`sumThisMonth(daily)` (also exported) filters `dailySpend` to entries whose
date starts with the current `YYYY-MM` (UTC) and sums `costCents`. This is
what drives the "This month" stat card.

## UI components

### `UsageBreakdownTable`

Location: `src/components/product/usage_breakdown_table.tsx`

Props:

```ts
interface UsageBreakdownTableProps {
  rows: UsageCategoryBreakdown[];
}
```

Columns (4-column grid `[1fr_auto_auto_auto]`):

1. **Category** — lucide icon (from `CATEGORY_ICON`) + `row.label`.
2. **Runs** — `row.runs.toLocaleString("en-US")`, tabular-nums, muted.
3. **Spend** — `formatCents(row.costCents)` when > 0, otherwise an em-dash
   (`—`) in muted tone to make zero-by-design explicit.
4. **%** — `row.costCents / totalCost` rounded; empty string for zero-cost
   rows. `totalCost` is computed locally in the component from the passed
   rows (not from `summary.totalCostCents`), though the two agree.

Empty state: dashed-border card with a workflow icon and "No usage recorded
yet." when `rows.length === 0`.

### `UsageSparkChart`

Location: `src/components/product/usage_spark_chart.tsx`

Props:

```ts
interface UsageSparkChartProps {
  daily: UsageDailySpend[];
  caption?: string;
}
```

Rendering:

- Tailwind flex-of-divs: a `h-32` flex container with 2px gaps; each day is
  `flex-1`, so the chart is responsive and bar widths are implicit.
- Heights are **percentages of the window max**: `(costCents / max) * 100`
  clamped to a floor of `2%` for any non-zero day, so quiet workspaces with
  one big outlier still show every other day.
- Zero-cost days render a flat `2px` baseline tick in `bg-muted-foreground/15`.
- Non-zero days render `bg-emerald-500/70` with `group-hover:bg-emerald-500`.
- Hover is surfaced via the native `title` attribute —
  `"{Apr 22} — {$1.23} ({N runs})"`. No JS tooltip, no client bundle cost.
- Caption row below the bars shows the first date on the left, the optional
  `caption` prop centered, and the last date on the right.
- `formatLabel` is UTC-pinned via `Intl.DateTimeFormat("en-US", { ...,
  timeZone: "UTC" })` so server render and hydration agree on the label.

## Navigation

The usage dashboard is linked from the `advancedNav` array in
`src/components/product/app_sidebar.tsx`:

```ts
{ label: "Usage", href: "/app/usage", icon: BarChart3 },
```

`BarChart3` is the lucide-react icon; the link sits between **Workflows**
and **Proposals** in the advanced nav section.

## Limitations

- **No double-count rule.** `inline_command_invocations` and
  `agent_trigger_runs` are recorded at `costCents: 0` in both
  `byCategory` and `dailySpend`. Their spend flows through the linked
  sub-agent / operator row and is billed there. Treat the run counts for
  these two categories as informational only — they will add to
  `totalRuns` but never to `totalCostCents`.
- **Sub-agent model is unknown.** `subagent_invocations` has no `model`
  column today, so the service passes `null` to `tokenCost` and pricing
  falls back to `FALLBACK_MODEL`. Once the column lands the read updates
  in-place without any UI change.
- **Hard caps.** Every window query is `.limit(2000)`. A workspace with
  more than 2000 operator runs, sub-agent invocations, workflow runs,
  inline commands, or trigger runs **per 30 days** will silently truncate
  the window. <!-- TODO: verify no pagination fallback planned -->
- **Token-derived cost vs. billing.** Cost for operator / sub-agent rows
  is computed at read time from `computeEstimatedCostCents`, the same
  helper the billing rollup uses, so the dashboard and billing settings
  are expected to agree to the cent. Workflow cost is read from the
  denormalized `total_cost_cents` column, which must be written correctly
  by the workflow runner for the breakdown to match.
- **UTC boundaries only.** Daily buckets and "this month" both use UTC.
  A workspace operating in, say, PT will see the day boundary advance at
  17:00 local. <!-- TODO: verify whether a user-timezone override is
  planned -->
- **Window queries are capped at 2000 rows** but `recentRuns` is sourced
  from a separate `limit(5)` fetch per category — so the recent list is
  always up to date even if the window is saturated.
