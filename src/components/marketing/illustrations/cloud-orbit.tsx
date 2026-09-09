"use client";

import { cn } from "@/lib/utils";
import { Mark } from "@/components/brand/logo";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useState } from "react";
import { FitScale } from "./fit-scale";

/**
 * Company OS at the centre, exchanging context with the sources that read and
 * write the same ledger: the first-party products, Composio for third-party
 * SaaS, and any MCP client an agent runs in. Adapted from ForgeUI "Cloud
 * Orbit"; the beam timing, the pulse and the 3.5s loop are the original's.
 */
const SOURCES: { label: string; pos: string; direction: number }[] = [
  { label: "Stored", pos: "top-1/2 left-[6px]", direction: -3 },
  { label: "Operate", pos: "top-[52px] left-[28px]", direction: -3 },
  { label: "Govern", pos: "bottom-[32px] left-[28px]", direction: -3 },
  { label: "Scalar", pos: "top-1/2 right-[6px]", direction: 3 },
  { label: "Composio", pos: "top-[52px] right-[28px]", direction: 3 },
  { label: "MCP clients", pos: "right-[28px] bottom-[32px]", direction: 3 },
];

export function CloudOrbit({ className }: { className?: string }) {
  const [animationKey, setAnimationKey] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const interval = setInterval(() => {
      setAnimationKey((prev) => prev + 1);
    }, 3500);
    return () => clearInterval(interval);
  }, [reduced]);

  return (
    <div className={className}>
      <FitScale width={330} height={220}>
        <CloudOrbitScene key={animationKey} reduced={Boolean(reduced)} />
      </FitScale>
    </div>
  );
}

function CloudOrbitScene({ reduced }: { reduced: boolean }) {
  const pulseVariants: Variants = {
    open: {
      boxShadow: [
        "0 0 0 0 var(--pulse-color) inset",
        "0 0 10px 1px var(--pulse-color) inset",
        "0 0 10px 1px var(--pulse-color) inset",
        "0 0 0 0 var(--pulse-color) inset",
      ],
      scale: [1, 0.9, 0.9, 1],
      transition: {
        duration: 1.7,
        times: [0, 0.75, 0.85, 1],
        delay: 0.2,
        ease: "easeInOut",
      },
    },
    close: {
      boxShadow: "0 0 0 0 var(--pulse-color) inset",
      scale: 1,
      transition: { duration: 0.1, ease: "easeInOut" },
    },
  };

  return (
    <div className="relative mx-auto h-[220px] w-full max-w-[330px] min-w-[330px] overflow-hidden">
      <div className="absolute top-0 left-[24px] h-full w-[120px]">
        <AnimatedLeftPaths />
      </div>
      <div className="absolute top-0 right-[24px] h-full w-[120px]">
        <AnimatedRightPaths />
      </div>
      {SOURCES.map(({ label, pos, direction }, i) => (
        <motion.div
          key={i}
          className={cn(
            pos,
            "absolute -mt-[20px]",
            "flex h-[40px] items-center justify-center rounded-full px-5",
            "bg-raised shadow-elev-1",
          )}
          initial={{
            transform: "translateX(0px)",
            "--animated-border-opacity": 0,
          }}
          animate={
            reduced
              ? undefined
              : {
                  transform: [
                    "translateX(0px)",
                    `translateX(${direction}px)`,
                    "translateX(0px)",
                  ],
                  "--animated-border-opacity": [0, 1, 1, 0],
                }
          }
          transition={{
            transform: { duration: 1.3, ease: "easeInOut", delay: 2 },
            "--animated-border-opacity": {
              duration: 1,
              ease: "easeOut",
              delay: 2.1,
              times: [0, 0.2, 0.8, 1],
            },
          }}
          style={{
            border: "1px solid var(--line-border)",
            outline:
              "1px solid color-mix(in srgb, var(--text-primary) calc(var(--animated-border-opacity) * 100%), transparent)",
            outlineOffset: -1,
          }}
        >
          <span className="t-mk-ill-11 whitespace-nowrap text-ink">
            {label}
          </span>
        </motion.div>
      ))}
      <motion.div
        variants={pulseVariants}
        initial="close"
        animate={reduced ? "close" : "open"}
        className={cn(
          "absolute inset-x-0 top-1/2 mx-auto -mt-[45px] flex h-[90px] w-[90px]",
          "items-center justify-center rounded-full border border-border bg-raised shadow-elev-2",
        )}
        style={{ "--pulse-color": "var(--line-strong)" } as React.CSSProperties}
      >
        <Mark size={40} className="text-ink" />
      </motion.div>
      <style>{`
      .co-line {
  offset-anchor: 10px 0px;
  animation: co-line-path;
  animation-timing-function: cubic-bezier(0.275, 0.72, 0.165, 0.99);
  animation-duration: 2.5s;
  animation-delay: 1.7s;
}
.co-line-1 { offset-path: path("M 68 30 l -20 -15 q -5 -4 -6 -4 h -60"); }
.co-line-2 { offset-path: path("M 65 42 h -100"); }
.co-line-3 { offset-path: path("M 65 49 h -100"); }
.co-line-4 { offset-path: path("M 68 61 l -20 15 q -5 4 -6 4 h -60"); }
.co-line-5 { offset-path: path("M 3 30 l 20 -15 q 5 -4 6 -4 h 90"); }
.co-line-6 { offset-path: path("M 5 42 h 100"); }
.co-line-7 { offset-path: path("M 5 49 h 100"); }
.co-line-8 { offset-path: path("M 3 61 l 20 15 q 5 4 6 4 h 90"); }
@keyframes co-line-path {
  0% { offset-distance: 0%; }
  100% { offset-distance: 100%; }
}
      `}</style>
    </div>
  );
}

const LEFT_PATHS = [
  "M 65 30 l -20 -15 q -5 -4 -6 -4 h -17",
  "M 65 42 h -60",
  "M 65 49 h -60",
  "M 65 61 l -20 15 q -5 4 -6 4 h -17",
];
const RIGHT_PATHS = [
  "M 5 30 l 20 -15 q 5 -4 6 -4 h 17",
  "M 5 42 h 60",
  "M 5 49 h 60",
  "M 5 61 l 20 15 q 5 4 6 4 h 17",
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
            className={`co-line co-line-${lineOffset + i}`}
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

function AnimatedLeftPaths() {
  return <BeamPaths paths={LEFT_PATHS} idPrefix="co-l" lineOffset={1} />;
}

function AnimatedRightPaths() {
  return <BeamPaths paths={RIGHT_PATHS} idPrefix="co-r" lineOffset={5} />;
}
