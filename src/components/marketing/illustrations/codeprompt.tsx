"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "codeprompt" block. The editor window
// and the prompt card overlap at the original offsets. The editor shows the
// JSON-RPC body of an MCP document_put; the original's per-token hex palette
// is replaced by three ink rungs (keys, strings, punctuation). The prompt
// card was frosted in the original; it is a flat raised surface here.

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

const K = "text-ink";
const S = "text-ink-2";
const P = "text-ink-4";

function Ln({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex">
      <span className="w-[28px] shrink-0 pr-5 text-right text-ink-4 select-none">
        {n}
      </span>
      <span className="whitespace-pre">{children}</span>
    </div>
  );
}

function Pair({
  k,
  v,
  indent,
  comma = true,
}: {
  k: string;
  v?: string;
  indent: number;
  comma?: boolean;
}) {
  return (
    <>
      <span className={P}>{" ".repeat(indent)}</span>
      <span className={K}>&quot;{k}&quot;</span>
      <span className={P}>: </span>
      {v === undefined ? (
        <span className={P}>{"{"}</span>
      ) : (
        <>
          <span className={S}>&quot;{v}&quot;</span>
          {comma && <span className={P}>,</span>}
        </>
      )}
    </>
  );
}

export const CodePrompt = ({ className }: { className?: string }) => {
  return (
    <FitScale width={580} height={384} className={className}>
      <div className="relative h-full w-full">
        <div
          className="absolute overflow-hidden rounded-tl-16 border border-border bg-raised shadow-elev-2"
          style={{ left: 132, top: 44, width: 520, height: 380 }}
        >
          <div className="relative flex items-center gap-4 px-6 py-5">
            <span className="size-[12px] rounded-full bg-strong" />
            <span className="size-[12px] rounded-full bg-hairline" />
            <span className="size-[12px] rounded-full bg-hairline" />
          </div>

          <div className="t-mk-ill-mono-11 relative px-6 pt-1">
            <Ln n={1}>
              <span className={P}>{"{"}</span>
            </Ln>
            <Ln n={2}>
              <Pair k="jsonrpc" v="2.0" indent={2} />
            </Ln>
            <Ln n={3}>
              <Pair k="method" v="tools/call" indent={2} />
            </Ln>
            <Ln n={4}>
              <Pair k="params" indent={2} />
            </Ln>
            <Ln n={5}>
              <Pair k="name" v="document_put" indent={4} />
            </Ln>
            <Ln n={6}>
              <Pair k="arguments" indent={4} />
            </Ln>
            <Ln n={7}>
              <Pair k="slug" v="icp" indent={6} />
            </Ln>
            <Ln n={8}>
              <Pair k="base_content_hash" v="a3f9c1e" indent={6} />
            </Ln>
            <Ln n={9}>
              <Pair
                k="message"
                v="Update ICP after Q3 interviews"
                indent={6}
                comma={false}
              />
            </Ln>
            <Ln n={10}>
              <span className={P}>{"    }"}</span>
            </Ln>
            <Ln n={11}>
              <span className={P}>{"  }"}</span>
            </Ln>
            <Ln n={12}>
              <span className={P}>{"}"}</span>
              <span
                data-mk-motion=""
                className="ml-1 inline-block h-[12px] w-[6px] translate-y-[2px] bg-ink-2"
                style={{ animation: "mk-caret 1.1s step-end infinite" }}
              />
            </Ln>
            <Ln n={13}> </Ln>
            <Ln n={14}>
              <span className={P}>
                {"// refused if a3f9c1e is no longer head"}
              </span>
            </Ln>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[176px]"
          style={{
            background:
              "linear-gradient(to right, transparent, var(--surface-canvas))",
          }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[128px]"
          style={{
            background:
              "linear-gradient(to top, var(--surface-canvas), transparent)",
          }}
        />

        <div
          className="absolute z-20 rounded-16 border border-border bg-raised px-7 pt-7 pb-10 shadow-elev-2"
          style={{ left: 36, top: 210, width: 324 }}
        >
          <p className="t-mk-ill-13 text-ink">
            Update the ICP after the Q3 interviews,{" "}
            <span className="text-ink-3">
              then commit it against a3f9c1e with a message.
            </span>
          </p>
        </div>
      </div>
    </FitScale>
  );
};

export default CodePrompt;
