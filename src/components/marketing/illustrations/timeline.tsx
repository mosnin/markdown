"use client";

import { cn } from "@/lib/utils";
import { FitScale } from "./fit-scale";

/**
 * A revision history: commits laid on a ruler of sequence numbers, with the
 * head revision marked. Adapted from ForgeUI "Timeline"; the ruler geometry,
 * the card positions and the playhead are the original's.
 */
const RULER_LEFT = 24;
const RULER_RIGHT = 496;
const TICK_COUNT = 40;
const TICK_STEP = (RULER_RIGHT - RULER_LEFT) / TICK_COUNT;
const tickX = (i: number) => RULER_LEFT + i * TICK_STEP;

const LABELS: { i: number; text: string }[] = [
  { i: 0, text: "#0138" },
  { i: 7, text: "#0139" },
  { i: 14, text: "#0140" },
  { i: 23, text: "#0141" },
  { i: 30, text: "#0142" },
];

const PLAYHEAD_X = 428;

const ROWS = [
  {
    title: "Update ICP after Q3 interviews",
    meta: "Dana · a3f9c1e",
    left: 44,
    width: 290,
    top: 90,
    authors: ["person", "person"],
  },
  {
    title: "Merge branch agent/pricing",
    meta: "Pricing agent · 5b2e7d0",
    left: 188,
    width: 250,
    top: 150,
    authors: ["agent"],
  },
  {
    title: "Founding commit",
    meta: "Dana · c0ffee1",
    left: 90,
    width: 228,
    top: 210,
    authors: ["person", "person"],
  },
];

function Authors({ kinds }: { kinds: string[] }) {
  return (
    <div className="flex items-center -space-x-2">
      {kinds.map((kind, i) => (
        <span
          key={i}
          className={cn(
            "size-[24px] rounded-full ring-2 ring-raised",
            kind === "agent" ? "bg-agent" : "bg-track",
          )}
          style={{ zIndex: kinds.length - i }}
        />
      ))}
    </div>
  );
}

export function RevisionTimeline({ className }: { className?: string }) {
  const playX = PLAYHEAD_X;

  return (
    <div className={className}>
      <FitScale width={520} height={300}>
        <div className="relative h-full w-full overflow-hidden">
          <div
            className="absolute h-px bg-border"
            style={{ left: RULER_LEFT, right: 520 - RULER_RIGHT, top: 60 }}
          />

          {Array.from({ length: TICK_COUNT + 1 }).map((_, i) => {
            const major = i % 7 === 0 || i === 23;
            return (
              <div
                key={i}
                className="absolute w-px bg-border"
                style={{
                  left: tickX(i),
                  top: major ? 52 : 55,
                  height: major ? 8 : 5,
                }}
              />
            );
          })}

          {LABELS.map((l) => (
            <span
              key={l.i}
              className="t-mk-ill-mono-11 absolute -translate-x-1/2 text-ink-3"
              style={{ left: tickX(l.i), top: 32 }}
            >
              {l.text}
            </span>
          ))}

          {ROWS.map((r) => (
            <div
              key={r.title}
              className="absolute z-10 flex items-center justify-between gap-6 rounded-12 border border-border bg-raised px-6 py-4 shadow-elev-1"
              style={{ left: r.left, top: r.top, width: r.width }}
            >
              <div className="min-w-0">
                <p className="t-mk-ill-13s truncate text-ink">{r.title}</p>
                <p className="t-mk-ill-mono-11 mt-1 text-ink-3">{r.meta}</p>
              </div>

              <Authors kinds={r.authors} />
            </div>
          ))}

          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-20 w-[48px] -translate-x-1/2 bg-positive/10 blur-2xl"
            style={{ left: playX, top: 34, bottom: 0 }}
          />

          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-30 w-px bg-positive/60"
            style={{ left: playX, top: 28, bottom: 0 }}
          />

          <div
            className="t-mk-ill-mono-11 absolute z-40 -translate-x-1/2 rounded-6 bg-positive-wash px-5 py-2 text-positive-text"
            style={{ left: playX, top: 6 }}
          >
            head
          </div>

          <EdgeFade side="left" />
          <EdgeFade side="right" />
          <EdgeFade side="bottom" />
        </div>
      </FitScale>
    </div>
  );
}

function EdgeFade({ side }: { side: "left" | "right" | "bottom" }) {
  const direction =
    side === "left" ? "to right" : side === "right" ? "to left" : "to top";
  const box =
    side === "left"
      ? "inset-y-0 left-0 w-[40px]"
      : side === "right"
        ? "inset-y-0 right-0 w-[32px]"
        : "inset-x-0 bottom-0 h-[40px]";
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute z-50", box)}
      style={{
        background: `linear-gradient(${direction}, var(--surface-canvas), transparent)`,
      }}
    />
  );
}
