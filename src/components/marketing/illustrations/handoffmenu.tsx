"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BsOpenai } from "react-icons/bs";
import {
  SiClaude,
  SiCursor,
  SiOpencode,
  SiZedindustries,
} from "react-icons/si";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "handoffmenu" block. Five stacked rows
// fading at the top and bottom, as the original. The rows are the MCP
// clients that can open a company's context; each keeps its own mark
// (these are the products' marks, not decoration) rendered in ink.

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

type Tool = {
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const TOOLS: Tool[] = [
  { label: "Connect from Claude", Icon: SiClaude },
  { label: "Open in Cursor", Icon: SiCursor },
  { label: "Continue in Codex", Icon: BsOpenai },
  { label: "Open in Zed", Icon: SiZedindustries },
  { label: "Run in Opencode", Icon: SiOpencode },
];

export const HandoffMenu = ({ className }: { className?: string }) => {
  return (
    <FitScale width={380} height={290} className={className}>
      <div className="relative h-full w-full">
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-4">
          {TOOLS.map((t) => (
            <div
              key={t.label}
              className="flex h-[44px] w-[300px] items-center gap-5 rounded-12 border border-hairline bg-inset px-6"
            >
              <t.Icon aria-hidden className="size-[20px] shrink-0 text-ink" />
              <span className="t-mk-ill-13 text-ink">{t.label}</span>
            </div>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[112px]"
          style={{
            background:
              "linear-gradient(to bottom, var(--surface-canvas), transparent)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[112px]"
          style={{
            background:
              "linear-gradient(to top, var(--surface-canvas), transparent)",
          }}
        />
      </div>
    </FitScale>
  );
};

export default HandoffMenu;
