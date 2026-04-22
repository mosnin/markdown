import { cn } from "@/lib/utils";
import {
  formatCents,
  type UsageDailySpend,
} from "@/server/services/usage_summary_service";

interface UsageSparkChartProps {
  daily: UsageDailySpend[];
  /**
   * Optional label rendered as a subtle caption beneath the bars. Used to
   * describe the time window (e.g. "Last 30 days").
   */
  caption?: string;
}

/**
 * Pure presentational bar chart for daily spend. Heights are scaled to the
 * window's maximum value so a quiet workspace still gets a readable
 * waveform; an all-zero window collapses to flat baseline rules.
 *
 * Implemented with raw flex + percentage heights — no chart library, no
 * client-side JS. Hover surfaces the date + dollar amount via the title
 * attribute.
 */
export function UsageSparkChart({ daily, caption }: UsageSparkChartProps) {
  const max = daily.reduce((m, d) => Math.max(m, d.costCents), 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex h-32 items-end gap-[2px]" role="img" aria-label="Daily spend bar chart">
        {daily.map((d) => {
          // Floor at 2% so days with non-zero spend remain visible even
          // when one outlier dominates the scale; days with literal zero
          // spend render as a faint baseline tick.
          const pct =
            max > 0 && d.costCents > 0
              ? Math.max(2, (d.costCents / max) * 100)
              : 0;
          const isZero = d.costCents === 0;
          return (
            <div
              key={d.date}
              className="group relative flex h-full flex-1 items-end"
              title={`${formatLabel(d.date)} — ${formatCents(d.costCents)} (${d.runs} ${d.runs === 1 ? "run" : "runs"})`}
            >
              <div
                className={cn(
                  "w-full rounded-sm transition-colors",
                  isZero
                    ? "bg-muted-foreground/15"
                    : "bg-emerald-500/70 group-hover:bg-emerald-500"
                )}
                style={{
                  height: isZero ? "2px" : `${pct}%`,
                  minHeight: isZero ? "2px" : "3px",
                }}
                aria-hidden="true"
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground/70">
        <span>{daily[0] ? formatLabel(daily[0].date) : ""}</span>
        {caption && <span>{caption}</span>}
        <span>{daily[daily.length - 1] ? formatLabel(daily[daily.length - 1].date) : ""}</span>
      </div>
    </div>
  );
}

/** "Apr 22" — locale-pinned to en-US for hydration stability. */
function formatLabel(yyyymmdd: string): string {
  // Build a UTC date so daylight-savings doesn't shift the day across
  // server/client renders.
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
