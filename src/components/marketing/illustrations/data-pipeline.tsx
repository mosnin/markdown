"use client";

import gsap from "gsap";
import { cn } from "@/lib/utils";
import { useGSAP } from "@gsap/react";
import { Check, ClipboardPaste, GitBranch, Loader } from "lucide-react";
import React, { useRef } from "react";
import { FitScale, usePrefersReducedMotion } from "./fit-scale";

/**
 * Import: pasted material is mapped onto the typed registry, drafted, and
 * committed to a branch for review. Adapted from ForgeUI "Data Pipeline"; the
 * timeline (glow, bar stagger, three 2s dash loaders, 1.2s repeat delay) is
 * the original's. Colour is animated through a custom property so the fill
 * resolves to the theme's positive mark instead of a hex.
 */
export function DataPipeline({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const topBarsRef = useRef<HTMLDivElement[]>([]);
  const bottomBarsRef = useRef<HTMLDivElement[]>([]);
  const spinnerRef = useRef<HTMLSpanElement>(null);
  const loader1Ref = useRef<SVGCircleElement>(null);
  const circle1Ref = useRef<SVGCircleElement>(null);
  const check1Ref = useRef<HTMLDivElement>(null);
  const loader2Ref = useRef<SVGCircleElement>(null);
  const circle2Ref = useRef<SVGCircleElement>(null);
  const check2Ref = useRef<HTMLDivElement>(null);
  const loader3Ref = useRef<SVGCircleElement>(null);
  const circle3Ref = useRef<SVGCircleElement>(null);
  const check3Ref = useRef<HTMLDivElement>(null);
  const firstGlowRef = useRef<HTMLSpanElement>(null);
  const secondGlowRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const ctx = gsap.context(() => {
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2 });

        tl.to(firstGlowRef.current, { opacity: 1, duration: 1.5, delay: 0.2 });
        tl.to(
          topBarsRef.current,
          { "--bar-on": 1, stagger: 0.12, duration: 0.3 },
          "start",
        );
        tl.to(
          spinnerRef.current,
          { rotation: 1500, ease: "power1.inOut", duration: 8 },
          "-=0.6",
        );
        tl.to(
          loader1Ref.current,
          { strokeDashoffset: 0, duration: 2, ease: "power1.inOut" },
          "<",
        );
        tl.to(
          circle1Ref.current,
          { opacity: 1, duration: 0.3, ease: "power2.out", delay: 2 },
          "<",
        );
        tl.to(
          check1Ref.current,
          { opacity: 1, duration: 0.3, ease: "power2.out" },
          "<",
        );
        tl.to(
          loader2Ref.current,
          {
            strokeDashoffset: 0,
            duration: 2,
            delay: 0.3,
            ease: "power1.inOut",
          },
          "<",
        );
        tl.to(
          circle2Ref.current,
          { opacity: 1, duration: 0.3, ease: "power2.out", delay: 2 },
          "<",
        );
        tl.to(
          check2Ref.current,
          { opacity: 1, duration: 0.3, ease: "power2.out" },
          "<",
        );
        tl.to(
          loader3Ref.current,
          {
            strokeDashoffset: 0,
            duration: 2,
            delay: 0.3,
            ease: "power1.inOut",
          },
          "<",
        );
        tl.to(
          circle3Ref.current,
          { opacity: 1, duration: 0.3, ease: "power2.out", delay: 2 },
          "<",
        );
        tl.to(
          check3Ref.current,
          { opacity: 1, duration: 0.3, ease: "power2.out" },
          "<",
        );
        tl.to({}, { duration: 0.5 });
        tl.to(
          bottomBarsRef.current,
          { "--bar-on": 1, stagger: 0.12, duration: 0.3 },
          "end",
        );
        tl.to(secondGlowRef.current, { opacity: 1, duration: 1.5 });

        if (reduced) tl.pause(tl.duration());
      });

      return () => ctx.revert();
    },
    { dependencies: [reduced], revertOnUpdate: true },
  );

  return (
    <div className={className}>
      <FitScale width={400} height={180}>
        <div className="mx-auto flex h-[180px] w-full max-w-[400px] items-center gap-1 px-1">
          <GlowingBox
            icon={
              <ClipboardPaste
                className="size-[28px] text-ink-2"
                strokeWidth={1.5}
              />
            }
            glowRef={firstGlowRef}
          />

          <div className="flex gap-px">
            {[4, 6, 6, 6, 6].map((width, idx) => (
              <div
                key={idx}
                ref={(el) => {
                  if (el) topBarsRef.current[idx] = el;
                }}
                className={cn("h-[8px]", width === 4 ? "w-[4px]" : "w-[6px]")}
                style={BAR_STYLE}
              />
            ))}
          </div>

          <div className="flex h-[129px] w-[180px] flex-col divide-y divide-hairline overflow-hidden rounded-6 border border-border">
            <div className="flex items-center gap-3 bg-inset px-2 py-3">
              <span ref={spinnerRef} className="flex">
                <Loader className="size-[14px] text-ink-2" />
              </span>
              <p className="t-mk-ill-12 text-ink-2">Paste</p>
            </div>
            <ProgressStep
              label="Map to kinds"
              loaderRef={loader1Ref}
              circleRef={circle1Ref}
              checkRef={check1Ref}
            />
            <ProgressStep
              label="Draft"
              loaderRef={loader2Ref}
              circleRef={circle2Ref}
              checkRef={check2Ref}
            />
            <ProgressStep
              label="Branch for review"
              loaderRef={loader3Ref}
              circleRef={circle3Ref}
              checkRef={check3Ref}
            />
          </div>

          <div className="flex gap-px">
            {[4, 6, 6, 6].map((width, idx) => (
              <div
                key={idx}
                ref={(el) => {
                  if (el) bottomBarsRef.current[idx] = el;
                }}
                className={cn("h-[2px]", width === 4 ? "w-[4px]" : "w-[6px]")}
                style={BAR_STYLE}
              />
            ))}
          </div>

          <GlowingBox
            icon={
              <GitBranch className="size-[28px] text-ink-2" strokeWidth={1.5} />
            }
            glowRef={secondGlowRef}
          />
        </div>
      </FitScale>
    </div>
  );
}

/* `--bar-on` runs 0 to 1 under GSAP; the fill mixes from the track colour to
   the positive mark, which is what "this stage has data" means here. */
const BAR_STYLE = {
  "--bar-on": 0,
  backgroundColor:
    "color-mix(in srgb, var(--positive-mark) calc(var(--bar-on) * 100%), var(--track))",
} as React.CSSProperties;

type ProgressStepProps = {
  label: string;
  loaderRef?: React.Ref<SVGCircleElement>;
  circleRef?: React.Ref<SVGCircleElement>;
  checkRef?: React.Ref<HTMLDivElement>;
};

function ProgressStep({
  label,
  loaderRef,
  circleRef,
  checkRef,
}: ProgressStepProps) {
  return (
    <div className="flex items-center justify-between bg-raised px-4 py-3">
      <p className="t-mk-ill-13s text-ink">{label}</p>
      <div className="relative">
        <svg width="20" height="20" className="-rotate-90">
          <circle
            ref={loaderRef}
            cx="10"
            cy="10"
            r="4.5"
            stroke="var(--positive-mark)"
            strokeWidth="2"
            fill="transparent"
            strokeDasharray="29"
            strokeDashoffset="29"
          />
          <circle
            ref={circleRef}
            cx="10"
            cy="10"
            r="4.5"
            fill="var(--positive-mark)"
            className="opacity-0"
          />
        </svg>
        <div
          ref={checkRef}
          className="absolute inset-0 flex items-center justify-center text-ink-inverse opacity-0"
        >
          <Check className="size-[8px]" strokeWidth={3} />
        </div>
      </div>
    </div>
  );
}

function GlowingBox({
  icon,
  glowRef,
}: {
  icon: React.ReactNode;
  glowRef?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <div className="relative flex size-[64px] shrink-0 items-center justify-center rounded-6 border border-border bg-raised p-4 shadow-elev-1">
      <span
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-6 opacity-0"
        style={{ boxShadow: "0 0 5px 2px var(--positive-mark)" }}
      />
      {icon}
    </div>
  );
}
