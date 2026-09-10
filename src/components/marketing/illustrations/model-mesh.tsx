"use client";

import { cn } from "@/lib/utils";
import { Mark } from "@/components/brand/logo";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { FitScale } from "./fit-scale";

/**
 * Poggle at the centre with six agent runtimes meshed around it: each one
 * writes to the same log, and the beams are events going in and briefs coming
 * back out. Adapted from ForgeUI "Model Mesh"; the ripple, the 3s beam and the
 * 2.5s loop are the original's.
 */
const NODES = [
  { label: "Claude Code", pos: "top-1/2 left-0" },
  { label: "Codex", pos: "top-1/2 right-0" },
  { label: "Cursor", pos: "top-[40px] left-[40px]" },
  { label: "Aider", pos: "top-[40px] right-[40px]" },
  { label: "CI", pos: "bottom-[20px] left-[40px]" },
  { label: "Git hooks", pos: "right-[40px] bottom-[20px]" },
];

export function ModelMesh({ className }: { className?: string }) {
  const [animationKey, setAnimationKey] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const interval = setInterval(() => {
      setAnimationKey((prev) => prev + 1);
    }, 2500);
    return () => clearInterval(interval);
  }, [reduced]);

  return (
    <div className={className}>
      <FitScale width={330} height={220}>
        <ModelMeshScene key={animationKey} reduced={Boolean(reduced)} />
      </FitScale>
    </div>
  );
}

function ModelMeshScene({ reduced }: { reduced: boolean }) {
  const rippleConfigs = [
    { size: 200, offset: 100, opacity: 0.3, delay: 0.9 },
    { size: 150, offset: 75, opacity: 0.35, delay: 0.7 },
    { size: 100, offset: 50, opacity: 0.4, delay: 0.5 },
  ];

  return (
    <div className="relative overflow-hidden">
      <div className="relative mx-auto h-[220px] w-full max-w-[330px] min-w-[330px] overflow-hidden">
        {rippleConfigs.map(({ size, offset, opacity, delay }, i) => (
          <motion.div
            key={i}
            initial={{ scale: 1 }}
            animate={reduced ? undefined : { scale: [1, 1.06, 1] }}
            transition={{ duration: 0.6, ease: "easeInOut", delay }}
            className="absolute inset-x-0 top-1/2 mx-auto rounded-full border border-strong bg-inset"
            style={{
              height: `${size}px`,
              width: `${size}px`,
              marginTop: `-${offset}px`,
              opacity,
            }}
          />
        ))}

        <div className="absolute top-0 left-[24px] h-full w-[120px]">
          <BeamPaths paths={LEFT_PATHS} idPrefix="mm-l" lineOffset={1} />
        </div>
        <div className="absolute top-0 right-[24px] h-full w-[120px]">
          <BeamPaths paths={RIGHT_PATHS} idPrefix="mm-r" lineOffset={4} />
        </div>
        {NODES.map(({ label, pos }, i) => (
          <div
            key={i}
            className={cn(
              "absolute -mt-[20px] flex h-[40px] items-center justify-center rounded-full border border-border bg-raised px-5 shadow-elev-1",
              pos,
            )}
          >
            <span className="t-mk-ill-11 whitespace-nowrap text-ink">
              {label}
            </span>
          </div>
        ))}
        <div className="absolute inset-x-0 top-1/2 mx-auto -mt-[35px] flex h-[70px] w-[70px] items-center justify-center rounded-full border border-border bg-raised shadow-elev-2">
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: "0 0 7px 1px var(--line-strong)" }}
            initial={{ opacity: 0 }}
            animate={reduced ? undefined : { opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.8, delay: 0.5, ease: "easeInOut" }}
          />
          <Mark size={32} className="text-ink" />
        </div>
      </div>
      <style>{`
      .mm-line {
  offset-anchor: 10px 0px;
  animation: mm-line-path;
  animation-timing-function: cubic-bezier(0.275, 0.72, 0.165, 0.99);
  animation-duration: 3s;
}
.mm-line-1 { offset-path: path("M 20 3.4 h 13 q 4 0 16 4 l 36 45"); }
.mm-line-2 { offset-path: path("M 0 44.8 h 95"); }
.mm-line-3 { offset-path: path("M 20 86.2 h 13 q 4 0 16 -4 l 36 -45"); }
.mm-line-4 { offset-path: path("M 50 3.4 h -13 q -4 0 -16 4 l -36 45"); }
.mm-line-5 { offset-path: path("M 75 44.8 h -95"); }
.mm-line-6 { offset-path: path("M 50 86.2 h -13 q -4 0 -16 -4 l -36 -45"); }
@keyframes mm-line-path {
  0% { offset-distance: 0%; }
  80% { offset-distance: 100%; }
  100% { offset-distance: 100%; }
}
      `}</style>
    </div>
  );
}

const LEFT_PATHS = [
  "M 30 3.4 h 13 q 4 0 8 4 l 24 28",
  "M 5 44.8 h 60",
  "M 30 86.2 h 13 q 4 0 8 -4 l 24 -28",
];
const RIGHT_PATHS = [
  "M 40 3.4 h -13 q -4 0 -8 4 l -24 28",
  "M 65 44.8 h -60",
  "M 40 86.2 h -13 q -4 0 -8 -4 l -24 -28",
];

function BeamPaths({
  paths,
  idPrefix,
  lineOffset,
}: {
  paths: string[];
  idPrefix: string;
  lineOffset: number;
}) {
  return (
    <svg
      className="h-full w-full"
      width="100%"
      height="100%"
      viewBox="0 0 70 90"
      fill="none"
    >
      <g stroke="var(--line-border)" strokeWidth="0.3">
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {paths.map((d, i) => (
        <g key={d} mask={`url(#${idPrefix}-mask-${i})`}>
          <circle
            data-mk-motion=""
            className={`mm-line mm-line-${lineOffset + i}`}
            cx="0"
            cy="0"
            r="12"
            fill={`url(#${idPrefix}-grad)`}
          />
        </g>
      ))}
      <defs>
        {paths.map((d, i) => (
          <mask key={d} id={`${idPrefix}-mask-${i}`}>
            <path d={d} strokeWidth="0.4" stroke="white" />
          </mask>
        ))}
        <radialGradient id={`${idPrefix}-grad`} fx="1">
          <stop offset="0%" stopColor="var(--text-primary)" />
          <stop offset="30%" stopColor="var(--text-primary)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
    </svg>
  );
}
