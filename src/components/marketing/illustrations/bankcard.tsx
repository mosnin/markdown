"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "bankcard" block. The card proportions
// and placement are the original's; the bank card is now an agent key card.

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

export const KeyCard = ({ className }: { className?: string }) => {
  return (
    <FitScale width={420} height={270} className={className}>
      <div className="relative flex h-full w-full items-center justify-center">
        <div className="relative h-[214px] w-[340px] overflow-hidden rounded-16 bg-inverse text-ink-inverse shadow-elev-3">
          {/* The chip slot: a ruled tile, the one piece of card grammar kept. */}
          <div className="absolute top-8 left-8 h-[36px] w-[48px] overflow-hidden rounded-6 bg-ink-inverse/12">
            <div className="absolute inset-x-0 top-1/3 h-px -translate-y-1/2 bg-ink-inverse/25" />
            <div className="absolute inset-x-0 bottom-1/3 h-px -translate-y-1/2 bg-ink-inverse/25" />
            <div className="absolute inset-y-0 left-1/3 w-px bg-ink-inverse/25" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-ink-inverse/25" />
          </div>

          <span className="t-label-caps absolute top-8 right-8 text-ink-inverse/60">
            sha256 stored
          </span>

          <div className="t-metric-md absolute top-[112px] left-8 font-mono text-ink-inverse/90">
            cos_7f3a
            <span className="text-ink-inverse/45">••••••••••••••••</span>
          </div>

          <span className="t-mk-ill-mono-11 absolute bottom-8 left-8 text-ink-inverse/70">
            context:read · context:write
          </span>

          <span className="t-mk-ill-11 absolute right-8 bottom-8 text-ink-inverse/70">
            shown once
          </span>
        </div>
      </div>
    </FitScale>
  );
};

export default KeyCard;
