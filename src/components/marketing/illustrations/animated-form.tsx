"use client";

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

// Adapted from the licensed ForgeUI "animated-form" block. Same card, same
// per-character typing stagger, same stroke-then-fill-then-check circles,
// same seven second loop. The form founds a company: the name types out,
// then the slug, and the four sources along the bottom connect one by one.
// The gradient title text and the brand icons are gone.

const SOURCES = ["Stored", "Operate", "Govern", "Scalar"];

export const AnimatedForm = ({ className }: { className?: string }) => {
  const [animationKey, setAnimationKey] = useState(0);
  const reduced = useReducedMotion() ?? false;

  const delayTime = 7000;

  useEffect(() => {
    if (reduced) return;
    const interval = setInterval(() => {
      setAnimationKey((prev) => prev + 1);
    }, delayTime);

    return () => clearInterval(interval);
  }, [delayTime, reduced]);

  return (
    <AnimatedFormCard
      key={animationKey}
      name="Acme Robotics"
      reduced={reduced}
      className={className}
    />
  );
};

export default AnimatedForm;

const AnimatedFormCard = ({
  name,
  reduced,
  className,
}: {
  name: string;
  reduced: boolean;
  className?: string;
}) => {
  const slug = "acme-robotics";
  const circleLength = 2 * Math.PI * 50;

  const nameAnimationDuration = Math.ceil(name.length / 5);
  const slugAnimationDuration = 2;
  const nameStaggerDelay = nameAnimationDuration / name.length;
  const slugStaggerDelay = slugAnimationDuration / slug.length;
  // The slug finishes at name + 0.5 + slug seconds; the four sources connect
  // right after, staggered so the last check lands before the 7s loop resets.
  const sourcesStart = nameAnimationDuration + 0.5 + slugAnimationDuration;
  const sourceStagger = 0.25;

  const FIELD =
    "flex w-full items-center justify-between gap-6 rounded-6 border border-hairline bg-object p-4";

  return (
    <div className={cn("relative w-full max-w-[340px]", className)}>
      <div className="w-full rounded-12 border border-hairline p-3">
        <div className="relative flex flex-col gap-1 divide-y divide-hairline rounded-8 border border-border bg-raised shadow-elev-1">
          <div className="t-mk-ill-12s px-5 pt-5 pb-4 text-ink-2">
            Found a company
          </div>
          <div className="flex flex-col gap-4 p-4">
            <div className={FIELD}>
              <div className="t-mk-ill-12 text-ink">
                {name.split("").map((char, index) => (
                  <motion.span
                    key={`name-${index}`}
                    className="inline-block"
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: 0.1,
                      delay: index * nameStaggerDelay,
                      ease: "easeOut",
                    }}
                  >
                    {char === " " ? " " : char}
                  </motion.span>
                ))}
              </div>

              <AnimatedCheckmarkCircle
                reduced={reduced}
                circleLength={circleLength}
                strokeDuration={nameAnimationDuration * 3 + 1}
                strokeDelay={0}
                fillDelay={nameAnimationDuration + 0.1}
                checkmarkDelay={nameAnimationDuration + 0.2}
              />
            </div>

            <div className={FIELD}>
              <div className="t-mk-ill-mono-12 pt-1 text-ink">
                {slug.split("").map((char, index) => (
                  <motion.span
                    key={`slug-${index}`}
                    className="inline-block"
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: 0.1,
                      delay:
                        nameAnimationDuration + 0.5 + index * slugStaggerDelay,
                      ease: "easeOut",
                    }}
                  >
                    {char}
                  </motion.span>
                ))}
              </div>

              <AnimatedCheckmarkCircle
                reduced={reduced}
                circleLength={circleLength}
                strokeDuration={7}
                strokeDelay={nameAnimationDuration + 0.5}
                fillDelay={nameAnimationDuration + slugAnimationDuration + 0.6}
                checkmarkDelay={
                  nameAnimationDuration + slugAnimationDuration + 0.7
                }
              />
            </div>
            <div className={cn(FIELD, "h-[37px] opacity-60")} />
          </div>
        </div>
      </div>
      <ContainerMask />
      <div className="absolute bottom-0 left-0 flex h-[50px] w-full items-center justify-around px-6">
        {SOURCES.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            <span className="t-mk-ill-11 text-ink">{label}</span>
            <AnimatedCheckmarkCircle
              reduced={reduced}
              circleLength={circleLength}
              strokeDuration={0.5}
              strokeDelay={sourcesStart + i * sourceStagger}
              fillDelay={sourcesStart + i * sourceStagger + 0.55}
              checkmarkDelay={sourcesStart + i * sourceStagger + 0.6}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

type AnimatedCheckmarkCircleProps = {
  reduced: boolean;
  circleLength: number;
  strokeDuration: number;
  strokeDelay: number;
  fillDelay: number;
  checkmarkDelay: number;
};

const AnimatedCheckmarkCircle = ({
  reduced,
  circleLength,
  strokeDuration,
  strokeDelay,
  fillDelay,
  checkmarkDelay,
}: AnimatedCheckmarkCircleProps) => {
  return (
    <div className="relative">
      <svg width="20" height="20" className="-rotate-90" aria-hidden="true">
        <motion.circle
          cx="10"
          cy="10"
          r="7"
          stroke="var(--positive-mark)"
          strokeWidth="2"
          fill="transparent"
          strokeDasharray={circleLength}
          strokeDashoffset={reduced ? 0 : circleLength}
          animate={{ strokeDashoffset: 0 }}
          transition={{
            duration: reduced ? 0 : strokeDuration,
            ease: "easeInOut",
            delay: reduced ? 0 : strokeDelay,
          }}
        />
        <motion.circle
          cx="10"
          cy="10"
          r="7"
          fill="var(--positive-mark)"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.2,
            delay: reduced ? 0 : fillDelay,
          }}
        />
      </svg>
      <motion.div
        className="absolute inset-0 flex items-center justify-center text-canvas"
        initial={reduced ? false : { opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          duration: 0.2,
          delay: reduced ? 0 : checkmarkDelay,
        }}
      >
        <Check className="size-[10px]" strokeWidth={3} />
      </motion.div>
    </div>
  );
};

const ContainerMask = () => {
  const up = "linear-gradient(to top, var(--surface-canvas) 60%, transparent)";
  return (
    <>
      <div
        className="absolute bottom-0 left-0 h-[40px] w-full"
        style={{ background: up }}
      />
      <div
        className="absolute bottom-0 left-0 h-[100px] w-[12px]"
        style={{ background: up }}
      />
      <div
        className="absolute right-0 bottom-0 h-[100px] w-[12px]"
        style={{ background: up }}
      />
    </>
  );
};
