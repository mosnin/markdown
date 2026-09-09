"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "trendlines" block. Two smoothed lines,
// a dashed crosshair and a legend card, exactly where the original put them.
// This month is series 1, last month is series 2.

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function FitScale({
  width,
  height,
  className,
  children,
}: {
  width: number;
  height: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex w-full justify-center overflow-hidden",
        className,
      )}
      style={{
        height: (scale || 1) * height,
        visibility: scale ? "visible" : "hidden",
      }}
    >
      <div
        className="relative shrink-0"
        style={{ width: width * scale, height: height * scale }}
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

type Pt = [number, number];
function smooth(pts: Pt[]): string {
  const first = pts[0];
  if (!first) return "";
  let d = `M ${first[0]} ${first[1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 8;
    const c1y = p1[1] + (p2[1] - p0[1]) / 8;
    const c2x = p2[0] - (p3[0] - p1[0]) / 8;
    const c2y = p2[1] - (p3[1] - p1[1]) / 8;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const AX = 300;
const DROP = 52;

const CURRENT: Pt[] = [
  [0, 162],
  [40, 150],
  [80, 158],
  [120, 134],
  [160, 150],
  [200, 126],
  [240, 140],
  [280, 98],
  [AX, 110],
  [340, 158],
  [380, 146],
  [420, 160],
  [460, 144],
];

const PREVIOUS: Pt[] = [
  [0, 146],
  [40, 138],
  [80, 150],
  [120, 156],
  [160, 144],
  [200, 150],
  [240, 142],
  [280, 148],
  [AX, 152],
  [340, 170],
  [380, 152],
  [420, 176],
  [460, 158],
];

const drop = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x, y + DROP]);
const yAt = (pts: Pt[]) => drop(pts).find((p) => p[0] === AX)![1];

const ROWS = [
  { bar: "bg-series-1", label: "This month", value: "42" },
  { bar: "bg-series-2", label: "Last month", value: "29" },
];

const fade = (dir: string) =>
  `linear-gradient(to ${dir}, var(--surface-canvas), transparent)`;

export const TrendLines = ({ className }: { className?: string }) => {
  return (
    <FitScale width={460} height={280} className={className}>
      <div className="relative h-full w-full">
        <svg
          viewBox="0 0 460 280"
          className="absolute inset-0 h-full w-full"
          fill="none"
          aria-hidden="true"
        >
          <line
            x1={AX}
            y1="86"
            x2={AX}
            y2="280"
            className="stroke-strong"
            strokeWidth="1"
            strokeDasharray="3 4"
          />

          <path
            d={smooth(drop(PREVIOUS))}
            className="stroke-series-2"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <path
            d={smooth(drop(CURRENT))}
            className="stroke-series-1"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <circle
            cx={AX}
            cy={yAt(PREVIOUS)}
            r="8"
            className="fill-series-2/15"
          />
          <circle
            cx={AX}
            cy={yAt(PREVIOUS)}
            r="4"
            className="fill-series-2 stroke-canvas"
            strokeWidth="2.5"
          />

          <circle
            cx={AX}
            cy={yAt(CURRENT)}
            r="11"
            className="fill-series-1"
            opacity="0.14"
          />
          <circle
            cx={AX}
            cy={yAt(CURRENT)}
            r="6.5"
            className="fill-series-1"
            opacity="0.24"
          />
          <circle
            cx={AX}
            cy={yAt(CURRENT)}
            r="4"
            className="fill-series-1 stroke-canvas"
            strokeWidth="2.5"
          />
        </svg>

        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[56px]"
          style={{ background: fade("right") }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-[56px]"
          style={{ background: fade("left") }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[64px]"
          style={{ background: fade("top") }}
        />

        <div
          className="absolute top-6 w-[192px] rounded-12 border border-border bg-raised px-6 py-5 shadow-elev-1"
          style={{ left: 172 }}
        >
          <p className="t-mk-ill-12s mb-4 text-ink">Documents committed</p>
          <div className="space-y-4">
            {ROWS.map((r) => (
              <div key={r.label} className="flex items-center gap-4">
                <span
                  className={`h-[14px] w-[3px] shrink-0 rounded-full ${r.bar}`}
                />
                <span className="t-mk-ill-12 text-ink-3">{r.label}</span>
                <span className="t-mk-ill-12s ml-auto text-ink tabular-nums">
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FitScale>
  );
};

export default TrendLines;
