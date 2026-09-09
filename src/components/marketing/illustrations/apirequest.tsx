"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "apirequest" block. Same two-card
// request and response layout; the call is now an MCP document_get.

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

const CARD = "bg-raised border border-border shadow-elev-1";

type Tone = "plain" | "head" | "agent";

const FIELDS: { k: string; v: string; tone?: Tone }[] = [
  { k: "kind", v: '"icp"' },
  { k: "slug", v: '"icp"' },
  { k: "seq", v: '"#0142"', tone: "head" },
  { k: "hash", v: '"a3f9c1e"', tone: "head" },
  { k: "author", v: '"agent"', tone: "agent" },
  { k: "branch", v: '"main"' },
];

const TONE: Record<Tone, string> = {
  plain: "text-ink-2",
  head: "text-positive-text",
  agent: "text-agent-text",
};

export const ApiRequest = ({ className }: { className?: string }) => {
  return (
    <FitScale width={540} height={352} className={className}>
      <div className="relative h-full w-full">
        <div className="mx-auto w-[460px] pt-9">
          <div
            className={`flex items-center gap-5 rounded-12 px-6 py-5 ${CARD}`}
          >
            <span className="t-mk-ill-mono-13 flex-1 truncate text-ink-3">
              mcp.companyos.sh
              <span className="text-ink">/tools/call</span>
            </span>
            <span className="t-mk-ill-mono-11 rounded-6 bg-inverse px-4 py-1 text-ink-inverse">
              document_get
            </span>
          </div>

          <div className={`mt-8 overflow-hidden rounded-t-12 ${CARD}`}>
            <div className="flex items-center gap-5 border-b border-hairline px-7 py-5">
              <span className="t-mk-ill-mono-12 text-ink-3">
                {'{ "slug": "icp" }'}
              </span>
              <span className="t-mk-ill-mono-12 ml-auto text-ink-4">
                142&nbsp;ms
              </span>
            </div>

            <div className="space-y-4 px-7 py-6">
              {FIELDS.map((f) => (
                <div key={f.k} className="t-mk-ill-mono-13 flex gap-4">
                  <span className="text-ink">&quot;{f.k}&quot;</span>
                  <span className="text-ink-4">:</span>
                  <span className={TONE[f.tone ?? "plain"]}>{f.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[160px]"
          style={{
            background:
              "linear-gradient(to top, var(--surface-canvas), transparent)",
          }}
        />
      </div>
    </FitScale>
  );
};

export default ApiRequest;
