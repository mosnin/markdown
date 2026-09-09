"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { FitScale } from "./fit-scale";

/**
 * The full JSON export: documents, their history and open branches flow up
 * into one file, so the context stays portable. Adapted from ForgeUI "Export
 * Flow"; the five converging paths, the 4s beam and the 3.2s loop are the
 * original's.
 */
export function ExportFlow({ className }: { className?: string }) {
  const [animationKey, setAnimationKey] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const interval = setInterval(() => {
      setAnimationKey((prev) => prev + 1);
    }, 3200);
    return () => clearInterval(interval);
  }, [reduced]);

  return (
    <div className={className}>
      <FitScale width={300} height={300}>
        <ExportFlowScene key={animationKey} reduced={Boolean(reduced)} />
      </FitScale>
    </div>
  );
}

const DOCS = ["business", "brand", "history", "branches", "people"];

function ExportFlowScene({ reduced }: { reduced: boolean }) {
  return (
    <div className="relative h-[300px] w-full max-w-[300px] min-w-[300px] overflow-hidden">
      <div className="absolute bottom-[60px] left-0 h-[50%] w-full">
        <AnimatedBelowPaths />
      </div>
      <div className="absolute top-0 left-0 h-[50%] w-full">
        <AnimatedTopPaths />
      </div>
      <div className="absolute bottom-[16px] left-0 flex h-[20%] w-full items-center justify-between">
        {DOCS.map((name) => (
          <DocumentGlyph key={name} label={name} />
        ))}
      </div>
      <div className="absolute top-1/2 left-[95px] -mt-[35px] flex items-center justify-center rounded-6 border border-border bg-raised px-5 py-3 shadow-elev-1">
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-6"
          style={{ boxShadow: "0 0 7px 1px var(--positive-mark)" }}
          initial={{ opacity: 0 }}
          animate={reduced ? undefined : { opacity: [0, 1, 1, 0] }}
          transition={{ duration: 2.5, delay: 0.5, ease: "easeInOut" }}
        />
        <span className="t-mk-ill-12s text-ink">Export JSON</span>
      </div>
      <div
        className="pointer-events-none absolute top-0 left-0 h-[96px] w-full"
        style={{
          background:
            "linear-gradient(to bottom, var(--surface-canvas) 50%, transparent 100%)",
        }}
      />
      <style>{`
      .ex-data {
  offset-anchor: 10px 0px;
  animation: ex-data-path;
  animation-timing-function: cubic-bezier(0.275, 0.72, 0.165, 0.99);
  animation-duration: 4s;
}
.ex-lw-1 { offset-path: path("M 14.5 98 v -35 q 0 -4 4 -4 h 74 q 4 0 4 -4 v -50"); }
.ex-lw-2 { offset-path: path("M 55.5 98 v -35 q 0 -4 4 -4 h 33 q 4 0 4 -4 v -50"); }
.ex-lw-3 { offset-path: path("M 96.5 98 v -85"); }
.ex-lw-4 { offset-path: path("M 137.5 98 v -35 q 0 -4 -4 -4 h -33 q -4 0 -4 -4 v -50"); }
.ex-lw-5 { offset-path: path("M 178.5 98 v -35 q 0 -4 -4 -4 h -74 q -4 0 -4 -4 v -50"); }
.ex-tp-1 { offset-path: path("M 92.5 87 v -90"); animation-delay: 1.85s; }
.ex-tp-2 { offset-path: path("M 96.5 87 v -90"); animation-delay: 2s; }
.ex-tp-3 { offset-path: path("M 100.5 87 v -90"); animation-delay: 2.15s; }
@keyframes ex-data-path {
  0% { offset-distance: 0%; }
  80% { offset-distance: 100%; }
  100% { offset-distance: 100%; }
}
      `}</style>
    </div>
  );
}

const BELOW_PATHS = [
  "M 14.5 98 v -35 q 0 -4 4 -4 h 74 q 4 0 4 -4 v -25",
  "M 55.5 98 v -35 q 0 -4 4 -4 h 33 q 4 0 4 -4 v -25",
  "M 96.5 98 v -68",
  "M 137.5 98 v -35 q 0 -4 -4 -4 h -33 q -4 0 -4 -4 v -25",
  "M 178.5 98 v -35 q 0 -4 -4 -4 h -74 q -4 0 -4 -4 v -25",
];
const TOP_PATHS = ["M 92.5 87 v -70", "M 96.5 87 v -70", "M 100.5 87 v -70"];

function BeamPaths({
  paths,
  idPrefix,
  lineClass,
}: {
  paths: string[];
  idPrefix: string;
  lineClass: string;
}) {
  return (
    <svg
      className="h-full w-full"
      width="100%"
      height="100%"
      viewBox="0 0 200 100"
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
            className={`ex-data ${lineClass}-${i + 1}`}
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

function AnimatedBelowPaths() {
  return <BeamPaths paths={BELOW_PATHS} idPrefix="ex-lw" lineClass="ex-lw" />;
}

function AnimatedTopPaths() {
  return <BeamPaths paths={TOP_PATHS} idPrefix="ex-tp" lineClass="ex-tp" />;
}

/** The document glyph, drawn in tokens: a page with a folded corner and three
 * rules. `label` names what flows out of it. */
function DocumentGlyph({ label }: { label: string }) {
  return (
    <span className="relative flex size-[56px] items-center justify-center">
      <svg viewBox="0 0 512 512" className="size-[56px]" aria-hidden="true">
        <path
          d="M410 472H72V10h258l80 80z"
          fill="var(--surface-object)"
          stroke="var(--line-strong)"
          strokeWidth="20"
        />
        <path
          d="M104 400h274v40H104zM104 360h180v20H104zM104 320h180v20H104z M327 20 v80h80z"
          fill="var(--line-strong)"
        />
      </svg>
      <span className="t-mk-ill-mono-11 absolute -bottom-[14px] whitespace-nowrap text-ink-3">
        {label}
      </span>
    </span>
  );
}
