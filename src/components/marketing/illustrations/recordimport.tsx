"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "recordimport" block. A source file on
// the left, the hand-drawn arrow, and a record card on the right at the
// original offsets. The spreadsheet brand mark is replaced by a plain CSV
// file glyph whose gradient stops are series and positive tokens.

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

function CsvIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="cos-ri-sheet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="cos-ri-rows" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--positive-mark)" />
          <stop
            offset="100%"
            stopColor="var(--positive-mark)"
            stopOpacity="0.55"
          />
        </linearGradient>
      </defs>
      <path
        d="M6 0h30l14 14v44a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6z"
        fill="url(#cos-ri-sheet)"
      />
      <path d="M36 0v14h14z" fill="var(--surface-canvas)" fillOpacity="0.35" />
      <rect
        x="10"
        y="26"
        width="36"
        height="5"
        rx="1.5"
        fill="url(#cos-ri-rows)"
      />
      <rect
        x="10"
        y="36"
        width="36"
        height="5"
        rx="1.5"
        fill="url(#cos-ri-rows)"
      />
      <rect
        x="10"
        y="46"
        width="24"
        height="5"
        rx="1.5"
        fill="url(#cos-ri-rows)"
      />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 370.353 370.353"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M368.432,166.578c-23.256-19.584-42.84-42.84-63.648-64.872c-11.016-11.628-28.151-34.884-46.512-36.108c-1.224-1.836-3.06-3.06-7.344-2.448c-2.448,0.612-4.284,2.448-4.896,4.896c-3.672,14.076-3.06,28.764-3.06,43.452c-53.856-7.344-116.893,19.584-159.732,48.348C36.115,191.057-0.605,243.078,0.007,301.217c0,2.448,1.836,3.672,3.672,4.284c1.836,1.836,4.284,2.448,6.732,1.224c70.992-50.184,145.044-94.247,235.009-78.947h0.611c-5.508,17.748-6.119,37.943-6.119,56.304c0,5.508,4.896,7.344,8.567,6.732c1.836,2.447,6.12,4.283,9.18,1.224c40.393-33.66,84.456-71.604,111.385-117.503C370.88,172.698,370.88,168.414,368.432,166.578z M348.235,183.102c-10.403,15.3-23.868,28.764-37.332,42.228c-18.359,18.36-39.168,34.272-56.916,53.244c0-16.524-0.611-33.048,0.612-50.185c0-1.836-0.612-3.06-1.836-3.672c1.836-3.672,1.224-8.567-3.672-9.792c-88.741-18.972-170.749,23.256-239.292,77.112c9.18-53.856,41.004-94.248,86.904-124.848s93.637-36.72,146.269-42.84v0.612c-0.612,4.896,7.344,5.508,8.568,1.224c0-1.224,0.611-1.836,0.611-3.06c3.672-1.836,4.896-6.732,1.836-8.568c1.836-9.792,2.448-19.584,3.672-29.376c0-1.836,0.612-4.896,1.225-7.956c7.956,10.404,21.42,19.584,30.6,28.764c17.748,18.36,34.272,37.944,52.632,56.304C351.907,170.862,356.191,170.862,348.235,183.102z" />
    </svg>
  );
}

const ROWS: [string, string, string?][] = [
  ["Source", "customers.csv"],
  ["Dataset", "customers"],
  ["Rows", "3 versioned"],
  ["Schema", "v2, 6 columns"],
  ["Commit", "#0143 · b17e04d", "head"],
];

export const RecordImport = ({ className }: { className?: string }) => {
  return (
    <FitScale width={480} height={280} className={className}>
      <div className="relative h-full w-full">
        <div
          className="absolute top-[176px] flex size-[96px] -translate-y-1/2 items-center justify-center"
          style={{ left: 40 }}
        >
          <CsvIcon className="h-[64px] w-[56px]" />
        </div>

        <ArrowIcon className="absolute top-1/2 left-[128px] size-[36px] -translate-y-1/2 text-strong" />

        <div
          className="absolute overflow-hidden rounded-16 border border-border bg-raised shadow-elev-1"
          style={{ left: 178, top: 20, width: 280, height: 320 }}
        >
          <div className="flex items-center gap-5 px-7 pt-6">
            <span className="t-mk-ill-mono-11 grid size-[44px] shrink-0 place-items-center rounded-8 bg-inset text-ink-2">
              csv
            </span>
            <div className="min-w-0">
              <p className="t-mk-ill-13s text-ink">customers.csv</p>
              <p className="t-mk-ill-11 mt-1 text-ink-3">
                Importing into dataset customers
              </p>
            </div>
          </div>

          <div className="mt-4 divide-y divide-hairline px-7">
            {ROWS.map(([label, value, tone]) => (
              <div
                key={label}
                className="flex h-[44px] items-center justify-between"
              >
                <span className="t-mk-ill-12 text-ink-3">{label}</span>
                <span
                  className={
                    tone === "head"
                      ? "t-mk-ill-mono-12 text-positive-text"
                      : "t-mk-ill-12s text-ink"
                  }
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 z-10 h-[96px]"
          style={{
            left: 178,
            width: 280,
            background:
              "linear-gradient(to top, var(--surface-canvas), transparent)",
          }}
        />
      </div>
    </FitScale>
  );
};

export default RecordImport;
