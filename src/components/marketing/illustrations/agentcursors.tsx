"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "agentcursors" block. The character rain,
// the three cursor positions and rotations are the original's. The rain now
// falls in hex digits (the alphabet of a content hash), and each cursor
// carries an identity tile instead of a tool icon: agents take a rounded
// square on the agent wash, the reviewer (a person) takes a round mark.

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

const W = 560;
const H = 380;

const CHARSET = ["a", "3", "f", "9", "c", "1", "e", "0", "7", "b"];
const COLS = 34;
const ROWS = 18;

function cellHash(r: number, c: number): number {
  const h = (r * 73856093) ^ (c * 19349663) ^ (r * c * 83492791);
  return h >>> 0;
}

function CodeRain() {
  return (
    <div
      aria-hidden
      className="t-mk-ill-mono-11 pointer-events-none absolute inset-0 grid select-none"
      style={{
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      }}
    >
      {Array.from({ length: ROWS * COLS }).map((_, i) => {
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        const h = cellHash(r, c);
        const blank = (h >> 6) % 4 === 0;

        const bright = (h >> 11) % 6 === 0;
        const op = bright ? 0.5 : 0.14 + ((h >> 3) % 6) * 0.03;
        return (
          <span
            key={i}
            className="flex items-center justify-center text-ink-3"
            style={{ opacity: blank ? 0 : op }}
          >
            {blank ? "" : CHARSET[h % CHARSET.length]}
          </span>
        );
      })}
    </div>
  );
}

type Tag = {
  x: number;
  y: number;
  rot: number;
  agent: boolean;
  mark: string;
  label: string;
};

const TAGS: Tag[] = [
  { x: 60, y: 74, rot: -6, agent: true, mark: "M", label: "Marketing agent" },
  { x: 342, y: 150, rot: 6, agent: true, mark: "F", label: "Finance agent" },
  { x: 150, y: 252, rot: -3, agent: false, mark: "R", label: "Reviewer" },
];

function AgentTag({ x, y, rot, agent, mark, label }: Tag) {
  return (
    <div className="absolute" style={{ left: x, top: y }}>
      <MousePointer2
        className={cn(
          "absolute -top-1 -left-1",
          agent ? "fill-agent text-agent" : "fill-ink text-ink",
        )}
        style={{
          transform: `rotate(${rot}deg)`,
          transformOrigin: "top left",
        }}
        size={24}
        strokeWidth={1}
      />
      <div className="absolute top-[18px] left-[18px] flex items-center gap-4 rounded-full border border-border bg-raised py-1 pr-5 pl-1 whitespace-nowrap shadow-elev-2">
        <span
          className={cn(
            "t-mk-ill-11 grid size-[24px] shrink-0 place-items-center",
            agent
              ? "rounded-6 bg-agent-wash text-agent-text"
              : "rounded-full bg-inset text-ink-2",
          )}
        >
          {mark}
        </span>
        <span className="t-mk-ill-13 text-ink">{label}</span>
      </div>
    </div>
  );
}

const fade = (dir: string) =>
  `linear-gradient(to ${dir}, var(--surface-canvas), transparent)`;

export const AgentCursors = ({ className }: { className?: string }) => {
  return (
    <FitScale width={W} height={H} className={className}>
      <div className="relative h-full w-full">
        <CodeRain />

        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[56px]"
          style={{ background: fade("bottom") }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[56px]"
          style={{ background: fade("top") }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[48px]"
          style={{ background: fade("right") }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-[48px]"
          style={{ background: fade("left") }}
        />

        {TAGS.map((t) => (
          <AgentTag key={t.label} {...t} />
        ))}
      </div>
    </FitScale>
  );
};

export default AgentCursors;
