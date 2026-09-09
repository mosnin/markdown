"use client";

import { cn } from "@/lib/utils";
import { FitScale } from "./fit-scale";

/**
 * A Finance document as a chart: the annual operating plan, one bar per
 * quarter-pair, the committed head revision highlighted. Adapted from ForgeUI
 * "Revenue Chart"; the bar heights, spacing and edge fades are the original's.
 * Monochrome on series-1, as the design language asks of a single-series bar.
 */
const BARS = [104, 120, 110, 92, 168, 120, 98];
const HIGHLIGHT = 4;

export function RevenueChart({ className }: { className?: string }) {
  return (
    <div className={className}>
      <FitScale width={460} height={280}>
        <div className="relative h-full w-full overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-6">
            {BARS.map((h, i) => {
              const active = i === HIGHLIGHT;
              return (
                <div key={i} className="relative flex items-end">
                  {active && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0 left-1/2 h-[208px] w-[160px] -translate-x-1/2 rounded-full bg-series-1/15 blur-3xl"
                    />
                  )}
                  <div
                    style={{ height: h }}
                    className={cn(
                      "relative w-[40px] rounded-t-6",
                      active ? "bg-series-1" : "bg-series-1/20",
                    )}
                  />
                </div>
              );
            })}
          </div>

          <Fade className="inset-x-0 top-0 h-[96px]" direction="to bottom" />
          <Fade className="inset-y-0 left-0 w-[112px]" direction="to right" />
          <Fade className="inset-y-0 right-0 w-[112px]" direction="to left" />
          <Fade className="inset-x-0 bottom-0 h-[96px]" direction="to top" />

          <div className="absolute top-[40px] left-[24px] z-20 rounded-12 border border-border bg-raised px-5 py-4 shadow-elev-1">
            <p className="t-mk-ill-11 text-ink-3">Annual operating plan</p>
            <p className="t-metric-md mt-1 text-ink">$12.4M</p>
            <p className="t-mk-ill-mono-11 mt-2 text-positive-text">
              head · #0142
            </p>
          </div>
        </div>
      </FitScale>
    </div>
  );
}

function Fade({
  className,
  direction,
}: {
  className: string;
  direction: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute z-10", className)}
      style={{
        background: `linear-gradient(${direction}, var(--surface-canvas), transparent)`,
      }}
    />
  );
}
