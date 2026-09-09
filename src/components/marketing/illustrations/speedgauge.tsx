"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "speedgauge" block. The scene, tick
// geometry and scale wrapper are the original's; colours resolve to tokens
// and the needle now sweeps to the company's template coverage.

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

const CX = 180;
const CY = 168;
const R_OUT = 112;
const A0 = -120;
const SWEEP = 240;
const N = 40;
const REST = -80;
const EDGE = 6;

const COMMITTED = 142;
const REGISTRY = 201;
// Needle angle for 142 of 201 templates on the 240 degree sweep.
const TARGET = A0 + (COMMITTED / REGISTRY) * SWEEP;

function polar(d: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;

  const round = (n: number) => +n.toFixed(3);
  return [round(CX + d * Math.sin(a)), round(CY - d * Math.cos(a))];
}

// Coverage rises left to right, so the low end of the arc is the critical
// band, the middle is caution and the top is positive. The original blended
// between its three hues; tokens are not blendable, so the bands are crisp.
function rampColor(t: number): string {
  if (t <= 0.34) return "var(--critical-mark)";
  if (t <= 0.64) return "var(--caution-mark)";
  return "var(--positive-mark)";
}

const TICKS = Array.from({ length: N + 1 }, (_, i) => {
  const t = i / N;
  const deg = A0 + t * SWEEP;
  const major = i % 5 === 0;
  const [x1, y1] = polar(major ? 92 : 100, deg);
  const [x2, y2] = polar(R_OUT, deg);
  const edgeFade = Math.min(1, (Math.min(i, N - i) + 0.5) / EDGE);
  return {
    x1,
    y1,
    x2,
    y2,
    w: major ? 3 : 2,
    color: rampColor(t),
    op: +((major ? 0.95 : 0.42) * edgeFade).toFixed(3),
  };
});

const fade = (dir: string) =>
  `linear-gradient(to ${dir}, var(--surface-canvas), transparent)`;

export const SpeedGauge = ({ className }: { className?: string }) => {
  return (
    <FitScale width={360} height={250} className={className}>
      <div className="relative h-full w-full">
        <svg
          viewBox="0 0 360 250"
          className="absolute inset-0 h-full w-full text-ink"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="cos-sp-needle" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop
                offset="0%"
                stopColor="var(--positive-mark)"
                stopOpacity="0.55"
              />
              <stop
                offset="58%"
                stopColor="var(--positive-mark)"
                stopOpacity="1"
              />
              <stop offset="84%" stopColor="currentColor" />
              <stop offset="100%" stopColor="currentColor" />
            </linearGradient>
            <radialGradient id="cos-sp-ball" cx="0.36" cy="0.31" r="0.85">
              <stop offset="0%" stopColor="var(--surface-raised)" />
              <stop offset="30%" stopColor="var(--surface-inset)" />
              <stop offset="70%" stopColor="var(--line-border)" />
              <stop offset="100%" stopColor="var(--line-strong)" />
            </radialGradient>
            <radialGradient id="cos-sp-halo" cx="0.5" cy="0.5" r="0.5">
              <stop
                offset="0%"
                stopColor="var(--surface-raised)"
                stopOpacity="0.28"
              />
              <stop
                offset="60%"
                stopColor="var(--surface-raised)"
                stopOpacity="0.05"
              />
              <stop
                offset="100%"
                stopColor="var(--surface-raised)"
                stopOpacity="0"
              />
            </radialGradient>
            <radialGradient id="cos-sp-shadow" cx="0.5" cy="0.5" r="0.5">
              <stop
                offset="0%"
                stopColor="var(--text-primary)"
                stopOpacity="0.28"
              />
              <stop
                offset="100%"
                stopColor="var(--text-primary)"
                stopOpacity="0"
              />
            </radialGradient>
          </defs>

          {TICKS.map((tk, i) => (
            <line
              key={i}
              x1={tk.x1}
              y1={tk.y1}
              x2={tk.x2}
              y2={tk.y2}
              stroke={tk.color}
              strokeWidth={tk.w}
              strokeOpacity={tk.op}
              strokeLinecap="round"
            />
          ))}

          <g
            data-mk-motion=""
            style={{
              transformBox: "view-box",
              transformOrigin: `${CX}px ${CY}px`,
              transform: `rotate(${TARGET}deg)`,
              animation: "cos-sp-sweep 7s ease-in-out infinite",
            }}
          >
            <polygon
              points="177,168 183,168 180,72"
              fill="url(#cos-sp-needle)"
              strokeLinejoin="round"
            />
          </g>

          <ellipse
            cx={CX}
            cy={CY + 13}
            rx={15}
            ry={5}
            fill="url(#cos-sp-shadow)"
          />
          <circle cx={CX} cy={CY} r={22} fill="url(#cos-sp-halo)" />
          <circle cx={CX} cy={CY} r={12} fill="url(#cos-sp-ball)" />
          <ellipse
            cx={CX - 3.6}
            cy={CY - 3.6}
            rx={3}
            ry={2.2}
            fill="var(--surface-raised)"
          />
        </svg>

        <div
          className="absolute inset-x-0 flex flex-col items-center"
          style={{ top: 198 }}
        >
          <span className="t-metric-md font-mono text-ink">142 / 201</span>
          <span className="t-label-caps mt-1 text-ink-3">Coverage</span>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[48px]"
          style={{ background: fade("bottom") }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[56px]"
          style={{ background: fade("right") }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-[56px]"
          style={{ background: fade("left") }}
        />

        <style>{`@keyframes cos-sp-sweep{0%{transform:rotate(${REST}deg)}34%{transform:rotate(${TARGET}deg)}78%{transform:rotate(${TARGET}deg)}100%{transform:rotate(${REST}deg)}}`}</style>
      </div>
    </FitScale>
  );
};

export default SpeedGauge;
