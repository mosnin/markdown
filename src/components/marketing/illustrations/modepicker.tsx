"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Plus,
  RefreshCw,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "modepicker" block. The faded prior
// reply, the composer with a blinking caret, and the floating picker keep
// their positions and timing. The picker was a frosted panel in the
// original; it is now a flat overlay surface with a border (anti-slop rule 4).
// The mode icons are gone: DESIGN.md removed the icon beside "Draft with AI"
// and "Review with AI" in the product, and the same holds here.

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

type Mode = {
  title: string;
  desc: string;
  active?: boolean;
};

const MODES: Mode[] = [
  {
    title: "Draft with AI",
    desc: "Creates a typed working copy from committed context",
    active: true,
  },
  {
    title: "Review with AI",
    desc: "Proposes field-level changes for a member to commit",
  },
];

export const ModePicker = ({ className }: { className?: string }) => {
  return (
    <FitScale width={500} height={380} className={className}>
      <div className="relative h-full w-full overflow-hidden">
        <div className="absolute inset-x-0 top-0 px-9 pt-8">
          <p className="t-mk-ill-13 text-ink-4">Proposal ready</p>
          <p className="t-mk-ill-13 mt-6 max-w-[384px] text-ink-3">
            The ICP now names two pains from the Q3 interviews. Commit it as a
            draft, or review each field first?
          </p>
          <div className="mt-6 flex items-center gap-7 text-ink-4">
            <ThumbsUp className="size-[16px]" />
            <ThumbsDown className="size-[16px]" />
            <RefreshCw className="size-[16px]" />
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[56px]"
          style={{
            background:
              "linear-gradient(to bottom, var(--surface-canvas), transparent)",
          }}
        />

        <div className="absolute inset-x-8 bottom-5 z-10 rounded-12 border border-border bg-raised shadow-elev-1">
          <div className="t-mk-ill-13 px-7 pt-6 pb-1 text-ink">
            Update the ICP with what we heard in the Q3 interviews
            <span
              data-mk-motion=""
              className="ml-1 inline-block h-[16px] w-px translate-y-[2px] bg-ink-2"
              style={{ animation: "mk-caret 1.1s step-end infinite" }}
            />
          </div>

          <div className="flex items-center gap-4 px-5 pt-4 pb-5">
            <button
              type="button"
              aria-label="Attach context"
              className="flex size-[32px] items-center justify-center rounded-8 text-ink-3"
            >
              <Plus className="size-[18px]" />
            </button>

            <span className="t-mk-ill-13 rounded-8 bg-inset px-5 py-3 text-ink">
              Draft with AI
            </span>

            <button
              type="button"
              aria-label="Send"
              className="ml-auto flex size-[36px] items-center justify-center rounded-12 bg-inverse text-ink-inverse"
            >
              <Send className="size-[14px] translate-x-px" />
            </button>
          </div>
        </div>

        <div
          className="absolute z-20 rounded-12 border border-border bg-overlay p-3 shadow-elev-2"
          style={{ left: 40, bottom: 78, width: 300 }}
        >
          {MODES.map((m) => (
            <div
              key={m.title}
              className={`relative flex items-start gap-5 rounded-8 px-5 py-4 ${
                m.active ? "bg-state-selected" : ""
              }`}
            >
              <div className="min-w-0 pr-8">
                <p className="t-mk-ill-13s text-ink">{m.title}</p>
                <p className="t-mk-ill-11 mt-1 text-ink-2">{m.desc}</p>
              </div>
              {m.active && (
                <span className="absolute top-1/2 right-6 -translate-y-1/2">
                  <MousePointer2
                    className="size-[16px] fill-ink text-ink"
                    style={{ transform: "scaleX(-1)" }}
                  />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </FitScale>
  );
};

export default ModePicker;
