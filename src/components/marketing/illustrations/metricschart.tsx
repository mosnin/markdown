"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "metricschart" block. Three smoothed
// area lines, a dashed crosshair with dots, and a legend card at the
// original offsets. Series 1 and 2 replace the green and red; the third
// line is neutral.

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

const BASE = 250;
const AX = 230;

const SERIES = [
  {
    key: "documents",
    color: "var(--series-1)",
    fill: "url(#cos-mc-1)",
    pts: [
      [0, 196],
      [38, 189],
      [76, 192],
      [115, 175],
      [153, 166],
      [191, 168],
      [AX, 140],
      [268, 128],
      [306, 131],
      [345, 106],
      [383, 94],
      [421, 97],
      [460, 74],
    ] as Pt[],
  },
  {
    key: "agents",
    color: "var(--series-2)",
    fill: "url(#cos-mc-2)",
    pts: [
      [0, 214],
      [38, 208],
      [76, 210],
      [115, 197],
      [153, 189],
      [191, 191],
      [AX, 166],
      [268, 153],
      [306, 156],
      [345, 132],
      [383, 120],
      [421, 123],
      [460, 100],
    ] as Pt[],
  },
  {
    key: "merges",
    color: "var(--neutral-mark)",
    fill: "url(#cos-mc-3)",
    pts: [
      [0, 230],
      [38, 225],
      [76, 227],
      [115, 215],
      [153, 208],
      [191, 210],
      [AX, 188],
      [268, 176],
      [306, 179],
      [345, 156],
      [383, 145],
      [421, 148],
      [460, 126],
    ] as Pt[],
  },
];

const ROWS = [
  { dot: "bg-series-1", label: "Open tickets", value: "24" },
  { dot: "bg-series-2", label: "Waiting on customer", value: "12" },
  { dot: "bg-neutral", label: "Resolved tickets", value: "64" },
];

const fade = (dir: string) =>
  `linear-gradient(to ${dir}, var(--surface-canvas), transparent)`;

export const MetricsChart = ({ className }: { className?: string }) => {
  return (
    <FitScale width={460} height={260} className={className}>
      <div className="relative h-full w-full">
        <svg
          viewBox="0 0 460 260"
          className="absolute inset-0 h-full w-full"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="cos-mc-1" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--series-1)"
                stopOpacity="0.12"
              />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="cos-mc-2" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--series-2)"
                stopOpacity="0.12"
              />
              <stop offset="100%" stopColor="var(--series-2)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="cos-mc-3" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--neutral-mark)"
                stopOpacity="0.1"
              />
              <stop
                offset="100%"
                stopColor="var(--neutral-mark)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          {[...SERIES].reverse().map((s) => (
            <path
              key={`area-${s.key}`}
              d={`${smooth(s.pts)} L 460 ${BASE} L 0 ${BASE} Z`}
              fill={s.fill}
            />
          ))}

          {[...SERIES].reverse().map((s) => (
            <path
              key={`line-${s.key}`}
              d={smooth(s.pts)}
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          <line
            x1={AX}
            y1="0"
            x2={AX}
            y2="260"
            className="stroke-strong"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {SERIES.map((s) => {
            const y = s.pts.find((p) => p[0] === AX)![1];
            return (
              <circle
                key={`dot-${s.key}`}
                cx={AX}
                cy={y}
                r="4"
                fill={s.color}
                className="stroke-canvas"
                strokeWidth="2.5"
              />
            );
          })}
        </svg>

        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[64px]"
          style={{ background: fade("right") }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-[64px]"
          style={{ background: fade("left") }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[56px]"
          style={{ background: fade("bottom") }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[64px]"
          style={{ background: fade("top") }}
        />

        <div
          className="absolute w-[200px] rounded-12 border border-border bg-raised px-5 py-5 shadow-elev-1"
          style={{ left: 40, top: 56 }}
        >
          <div className="space-y-4">
            {ROWS.map((r) => (
              <div key={r.label} className="flex items-center gap-4">
                <span className={`size-[8px] shrink-0 rounded-full ${r.dot}`} />
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

export default MetricsChart;
