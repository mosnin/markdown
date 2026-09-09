"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "codepresence" block. Same editor window
// at the same offset, same two live cursors at the same positions. The code
// is now a typed ICP document laid out as fields, the title bar carries who
// is present (people round, agents rounded-square on the agent wash), and the
// second cursor belongs to an agent.

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

function Field({ k, v }: { k: string; v?: string }) {
  return (
    <>
      <span className={K}>{k}</span>
      <span className={P}>:</span>
      {v !== undefined && <span className={S}> {v}</span>}
    </>
  );
}

function Item({ v }: { v: string }) {
  return (
    <>
      <span className={P}>{"  - "}</span>
      <span className={S}>{v}</span>
    </>
  );
}

type Cursor = {
  x: number;
  y: number;
  rot: number;
  agent: boolean;
  name: string;
};

const CURSORS: Cursor[] = [
  { x: 295, y: 140, rot: 6, agent: false, name: "Ana" },
  { x: 142, y: 326, rot: -8, agent: true, name: "Marketing agent" },
];

function LiveCursor({ x, y, rot, agent, name }: Cursor) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="absolute z-20"
      style={{ left: x, top: y }}
      animate={
        reduced
          ? { x: 0, y: 0 }
          : {
              x: [0, agent ? 24 : -16, 0],
              y: [0, agent ? -16 : 24, 0],
            }
      }
      transition={{
        duration: 5,
        delay: agent ? 1.2 : 0,
        repeat: Infinity,
        repeatDelay: 1,
        ease: "easeInOut",
      }}
    >
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
      <div
        className={cn(
          "t-mk-ill-12s absolute top-6 left-6 rounded-6 px-4 py-1 whitespace-nowrap shadow-elev-2",
          agent
            ? "bg-agent-wash text-agent-text"
            : "bg-inverse text-ink-inverse",
        )}
      >
        {name}
      </div>
    </motion.div>
  );
}

const PRESENT: { mark: string; agent: boolean }[] = [
  { mark: "A", agent: false },
  { mark: "J", agent: false },
  { mark: "M", agent: true },
];

export const CodePresence = ({ className }: { className?: string }) => {
  return (
    <FitScale width={580} height={384} className={className}>
      <div className="relative h-full w-full">
        <div
          className="absolute overflow-hidden rounded-16 border border-border bg-raised shadow-elev-2"
          style={{ left: 46, top: 70, width: 488 }}
        >
          <div className="relative flex items-center border-b border-hairline px-6 py-4">
            <div className="flex items-center gap-4">
              <span className="size-[12px] rounded-full bg-strong" />
              <span className="size-[12px] rounded-full bg-hairline" />
              <span className="size-[12px] rounded-full bg-hairline" />
            </div>
            <span className="t-mk-ill-mono-11 pointer-events-none absolute inset-x-0 text-center text-ink-3">
              icp · #0142 · a3f9c1e
            </span>
            <div className="ml-auto flex items-center gap-2">
              {PRESENT.map((p) => (
                <span
                  key={p.mark}
                  className={cn(
                    "t-mk-ill-11 grid size-[20px] place-items-center",
                    p.agent
                      ? "rounded-4 bg-agent-wash text-agent-text"
                      : "rounded-full bg-inset text-ink-2",
                  )}
                >
                  {p.mark}
                </span>
              ))}
            </div>
          </div>

          <div className="t-mk-ill-mono-12 relative px-6 pt-5 pb-8">
            <Ln n={1}>
              <Field k="kind" v="icp" />
            </Ln>
            <Ln n={2}>
              <Field k="department" v="marketing" />
            </Ln>
            <Ln n={3}> </Ln>
            <Ln n={4}>
              <Field k="segment" v="Operations leads at B2B companies" />
            </Ln>
            <Ln n={5}>
              <Field k="pains" />
            </Ln>
            <Ln n={6}>
              <Item v="Context lives in twelve tools" />
            </Ln>
            <Ln n={7}>
              <Item v="Agents guess at the business model" />
            </Ln>
            <Ln n={8}>
              <Field k="gains" />
            </Ln>
            <Ln n={9}>
              <Item v="One shared customer profile" />
            </Ln>
            <Ln n={10}>
              <Field k="buying_triggers" />
            </Ln>
            <Ln n={11}>
              <Item v="A new office or team" />
            </Ln>
            <Ln n={12}>
              <Item v="New head of operations" />
            </Ln>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[128px]"
          style={{
            background:
              "linear-gradient(to top, var(--surface-canvas), transparent)",
          }}
        />

        {CURSORS.map((c) => (
          <LiveCursor key={c.name} {...c} />
        ))}
      </div>
    </FitScale>
  );
};

export default CodePresence;
