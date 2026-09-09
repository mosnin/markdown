"use client";

import gsap from "gsap";
import { cn } from "@/lib/utils";
import { useGSAP } from "@gsap/react";
import { CircleCheck, Loader } from "lucide-react";
import React, { useRef } from "react";
import { FitScale, usePrefersReducedMotion } from "./fit-scale";

/**
 * The four steps from an empty company to an agent holding a key. Adapted
 * from ForgeUI "Onboarding Steps"; the rotating loader, the 3s progress fill
 * and the card shuffle offsets are the original's.
 */
const STEPS = [
  "Create the company",
  "Open the founding pages",
  "Commit the first context",
  "Hand an agent a key",
] as const;

export function OnboardingSteps({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const step1Ref = useRef<HTMLDivElement>(null);
  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);
  const loader1Ref = useRef<HTMLSpanElement>(null);
  const loader2Ref = useRef<HTMLSpanElement>(null);
  const loader3Ref = useRef<HTMLSpanElement>(null);
  const loader4Ref = useRef<HTMLSpanElement>(null);
  const check1Ref = useRef<HTMLSpanElement>(null);
  const check2Ref = useRef<HTMLSpanElement>(null);
  const check3Ref = useRef<HTMLSpanElement>(null);
  const check4Ref = useRef<HTMLSpanElement>(null);
  const progressBar1Ref = useRef<HTMLSpanElement>(null);
  const progressBar2Ref = useRef<HTMLSpanElement>(null);
  const progressBar3Ref = useRef<HTMLSpanElement>(null);
  const progressBar4Ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const ctx = gsap.context(() => {
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.5 });

        tl.to(loader1Ref.current, {
          rotate: 780,
          duration: 3,
          ease: "sine.inOut",
        });
        tl.to(
          progressBar1Ref.current,
          { width: "100%", duration: 3, ease: "power1.inOut" },
          "<",
        );
        tl.to(loader1Ref.current, {
          opacity: 0,
          duration: 0.3,
          ease: "power1.inOut",
        });
        tl.to(
          check1Ref.current,
          { opacity: 1, duration: 0.2, ease: "power1.inOut" },
          "+=0.1",
        );
        tl.to(step1Ref.current, { y: -53, scale: 0.9, delay: 0.3 });
        tl.to(step2Ref.current, { y: -52.5, scale: 1 }, "<");
        tl.to(step3Ref.current, { y: -49 }, "<");
        tl.to(step4Ref.current, { y: -49 }, "<");
        tl.to(loader2Ref.current, {
          rotate: 780,
          duration: 3,
          ease: "sine.inOut",
        });
        tl.to(
          progressBar2Ref.current,
          { width: "100%", duration: 3, ease: "power1.inOut" },
          "<",
        );
        tl.to(loader2Ref.current, {
          opacity: 0,
          duration: 0.3,
          ease: "power1.inOut",
        });
        tl.to(
          check2Ref.current,
          { opacity: 1, duration: 0.2, ease: "power1.inOut" },
          "+=0.1",
        );
        tl.to(step1Ref.current, { y: -105, delay: 0.3 });
        tl.to(step2Ref.current, { y: -105, scale: 0.9 }, "<");
        tl.to(step3Ref.current, { y: -102, scale: 1 }, "<");
        tl.to(step4Ref.current, { y: -98 }, "<");
        tl.set(step1Ref.current, { y: 100 });
        tl.set(loader1Ref.current, { opacity: 1 });
        tl.set(check1Ref.current, { opacity: 0 });
        tl.set(progressBar1Ref.current, { width: "0%" });
        tl.to(loader3Ref.current, {
          rotate: 780,
          duration: 3,
          ease: "sine.inOut",
        });
        tl.to(
          progressBar3Ref.current,
          { width: "100%", duration: 3, ease: "power1.inOut" },
          "<",
        );
        tl.to(loader3Ref.current, {
          opacity: 0,
          duration: 0.3,
          ease: "power1.inOut",
        });
        tl.to(
          check3Ref.current,
          { opacity: 1, duration: 0.2, ease: "power1.inOut" },
          "+=0.1",
        );
        tl.to(step2Ref.current, { y: -154, delay: 0.3 });
        tl.to(step3Ref.current, { y: -154.5, scale: 0.9 }, "<");
        tl.to(step4Ref.current, { y: -150.5, scale: 1 }, "<");
        tl.to(step1Ref.current, { y: 53 }, "<");
        tl.set(step2Ref.current, { y: 50 });
        tl.set(loader2Ref.current, { opacity: 1 });
        tl.set(check2Ref.current, { opacity: 0 });
        tl.set(progressBar2Ref.current, { width: "0%" });
        tl.to(loader4Ref.current, {
          rotate: 780,
          duration: 3,
          ease: "sine.inOut",
        });
        tl.to(
          progressBar4Ref.current,
          { width: "100%", duration: 3, ease: "power1.inOut" },
          "<",
        );
        tl.to(loader4Ref.current, {
          opacity: 0,
          duration: 0.3,
          ease: "power1.inOut",
        });
        tl.to(
          check4Ref.current,
          { opacity: 1, duration: 0.2, ease: "power1.inOut" },
          "+=0.1",
        );
        tl.to(step3Ref.current, { y: -202.5, delay: 0.3 });
        tl.to(step4Ref.current, { y: -202, scale: 0.9 }, "<");
        tl.to(step1Ref.current, { y: 0, scale: 1 }, "<");
        tl.to(step2Ref.current, { y: 0 }, "<");
        tl.set(step3Ref.current, { y: 0 });
        tl.set(loader3Ref.current, { opacity: 1 });
        tl.set(check3Ref.current, { opacity: 0 });
        tl.set(progressBar3Ref.current, { width: "0%" });
        tl.to(step4Ref.current, {
          opacity: 0,
          duration: 0.4,
          ease: "sine.inOut",
        });
        tl.set(loader4Ref.current, { opacity: 1 });
        tl.set(check4Ref.current, { opacity: 0 });
        tl.set(progressBar4Ref.current, { width: "0%" });
        tl.set(step4Ref.current, { y: 0, opacity: 1 });

        // Reduced motion: hold the first step at its completed state.
        if (reduced) tl.pause(3.6);
      });
      return () => ctx.revert();
    },
    { dependencies: [reduced] },
  );

  return (
    <div className={className}>
      <FitScale width={400} height={240}>
        <div className="relative mx-auto h-[220px] w-full overflow-hidden">
          <StepCard
            title={STEPS[0]}
            stepRef={step1Ref}
            checkRef={check1Ref}
            loaderRef={loader1Ref}
            progressRef={progressBar1Ref}
            className="top-[80px] scale-[1]"
          />
          <StepCard
            title={STEPS[1]}
            stepRef={step2Ref}
            checkRef={check2Ref}
            loaderRef={loader2Ref}
            progressRef={progressBar2Ref}
            className="top-[132px] scale-[0.9]"
          />
          <StepCard
            title={STEPS[2]}
            stepRef={step3Ref}
            checkRef={check3Ref}
            loaderRef={loader3Ref}
            progressRef={progressBar3Ref}
            className="top-[182px] scale-[0.9]"
          />
          <StepCard
            title={STEPS[3]}
            stepRef={step4Ref}
            checkRef={check4Ref}
            loaderRef={loader4Ref}
            progressRef={progressBar4Ref}
            className="top-[230px] scale-[0.9]"
          />
          <ContainerMask />
        </div>
      </FitScale>
    </div>
  );
}

function ContainerMask() {
  return (
    <>
      <div
        className="absolute bottom-0 left-0 h-[90px] w-full"
        style={{
          background:
            "linear-gradient(to top, var(--surface-canvas) 40%, transparent 100%)",
        }}
      />
      <div
        className="absolute top-0 left-0 h-[90px] w-full"
        style={{
          background:
            "linear-gradient(to bottom, var(--surface-canvas) 40%, transparent 100%)",
        }}
      />
    </>
  );
}

type StepCardProps = {
  title: string;
  stepRef?: React.Ref<HTMLDivElement>;
  checkRef?: React.Ref<HTMLSpanElement>;
  loaderRef?: React.Ref<HTMLSpanElement>;
  progressRef?: React.Ref<HTMLSpanElement>;
  className?: string;
};

export function StepCard({
  title,
  stepRef,
  checkRef,
  loaderRef,
  progressRef,
  className,
}: StepCardProps) {
  return (
    <div
      ref={stepRef}
      className={cn(
        "rounded-6 border border-border bg-raised px-5 py-4 shadow-elev-1",
        "absolute inset-x-0 mx-auto flex h-[48px] w-[90%] max-w-[250px] gap-3",
        className,
      )}
    >
      <div className="relative h-[30px] w-[14px]">
        <span
          ref={checkRef}
          className="absolute inset-x-0 top-[2px] flex text-positive-text opacity-0"
        >
          <CircleCheck size={14} />
        </span>
        <span
          ref={loaderRef}
          className="absolute inset-x-0 top-[3px] flex text-ink opacity-100"
        >
          <Loader size={13} />
        </span>
      </div>

      <div className="flex w-full flex-col justify-between gap-4">
        <p className="t-mk-ill-12 text-ink">{title}</p>
        <div className="flex h-[6px] w-[90%] rounded-2 bg-track">
          <span
            ref={progressRef}
            className="h-full w-[0%] rounded-2 bg-positive"
          />
        </div>
      </div>
    </div>
  );
}
