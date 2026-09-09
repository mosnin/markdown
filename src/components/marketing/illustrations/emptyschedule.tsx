"use client";

import { cn } from "@/lib/utils";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

// Adapted from the licensed ForgeUI "emptyschedule" block. Three offset rows
// and a two-line caption, as the original; the rows are stale documents with
// no review cadence.

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

export const EmptySchedule = ({ className }: { className?: string }) => {
  return (
    <FitScale width={460} height={300} className={className}>
      <div className="relative h-full w-full overflow-hidden">
        <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-8">
          <div className="relative h-[192px] w-[368px]">
            <ScheduleRow className="absolute top-0 left-[112px]" />
            <ScheduleRow className="absolute top-[64px] left-[8px]" />
            <ScheduleRow className="absolute top-[128px] left-[112px]" />
          </div>

          <div className="flex flex-col items-center gap-1 text-center">
            <p className="t-mk-ill-15s text-ink">No review cadence set</p>
            <p className="t-mk-ill-13 text-ink-3">
              Set review_every_days to keep this fresh
            </p>
          </div>
        </div>
      </div>
    </FitScale>
  );
};

export default EmptySchedule;

const ScheduleRow = ({ className = "" }: { className?: string }) => {
  return (
    <div
      className={cn(
        "flex h-[56px] w-[240px] items-center gap-5 rounded-8 border border-border bg-raised px-6 shadow-elev-1",
        className,
      )}
    >
      <div className="size-[36px] shrink-0 rounded-6 bg-inset" />
      <div className="flex flex-col gap-4">
        <div className="h-[8px] w-[112px] rounded-full bg-strong" />
        <div className="h-[6px] w-[64px] rounded-full bg-hairline" />
      </div>
      <span className="t-mk-ill-11 ml-auto text-caution-text">stale</span>
    </div>
  );
};
