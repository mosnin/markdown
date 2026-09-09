"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "integrationwall" block. The tilted
// six-column grid and its four edge fades are the original's. The tiles
// carry wordmarks instead of third-party logos: the first-party products,
// the two connection routes, and the categories of SaaS Composio reaches.

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

type Tile = { label: string; first?: boolean };

const TILES: Tile[] = [
  { label: "CRM" },
  { label: "Stored", first: true },
  { label: "Billing" },
  { label: "Operate", first: true },
  { label: "Support" },
  { label: "Payroll" },
  { label: "Govern", first: true },
  { label: "Docs" },
  { label: "Scalar", first: true },
  { label: "Email" },
  { label: "Composio", first: true },
  { label: "Tickets" },
  { label: "Calendar" },
  { label: "MCP", first: true },
  { label: "Chat" },
  { label: "HRIS" },
  { label: "Analytics" },
  { label: "Storage" },
  { label: "Contracts" },
  { label: "Forms" },
  { label: "Ads" },
  { label: "Sheets" },
  { label: "Notes" },
  { label: "Warehouse" },
];

const fade = (dir: string) =>
  `linear-gradient(to ${dir}, var(--surface-canvas), transparent)`;

export const IntegrationWall = ({ className }: { className?: string }) => {
  return (
    <FitScale width={460} height={300} className={className}>
      <div className="relative h-full w-full overflow-hidden">
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ perspective: "1400px" }}
        >
          <div
            className="grid grid-cols-6 gap-6"
            style={{ transform: "rotateX(36deg) rotateZ(12deg) scale(1.02)" }}
          >
            {TILES.map((t) => (
              <div
                key={t.label}
                className={cn(
                  "flex size-[64px] items-center justify-center rounded-16 border border-border shadow-elev-2",
                  t.first
                    ? "t-mk-ill-12s bg-raised text-ink"
                    : "t-mk-ill-11 bg-inset text-ink-3",
                )}
              >
                {t.label}
              </div>
            ))}
          </div>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[128px]"
          style={{ background: fade("bottom") }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[128px]"
          style={{ background: fade("top") }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[128px]"
          style={{ background: fade("right") }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[128px]"
          style={{ background: fade("left") }}
        />
      </div>
    </FitScale>
  );
};

export default IntegrationWall;
