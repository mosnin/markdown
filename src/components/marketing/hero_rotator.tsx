"use client";

import * as React from "react";
import * as m from "motion/react-m";
import { AnimatePresence, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { spring, tween } from "@/lib/motion";

/**
 * The one moving word in the hero headline.
 *
 * Cycles a short list of endings on a fixed-height, overflow-clipped line so
 * the word rolls up from below without ever shifting the surrounding layout.
 * Reduced-motion users (and the very first paint) simply see the first word,
 * held still. Decorative + aria-hidden — the canonical headline ending is
 * provided as sr-only text by the caller.
 */
export function HeroRotator({
  words,
  className,
}: {
  words: string[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (reduceMotion || words.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((prev) => (prev + 1) % words.length),
      2600,
    );
    return () => window.clearInterval(id);
  }, [reduceMotion, words.length]);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block h-[1.15em] overflow-hidden pb-[0.12em]",
        className,
      )}
    >
      <AnimatePresence initial={false}>
        <m.span
          key={index}
          initial={{ y: "108%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1, transition: spring.gentle }}
          exit={{ y: "-108%", opacity: 0, transition: tween.exit }}
          className="absolute inset-x-0 top-0 bg-gradient-to-r from-violet-300 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent"
        >
          {words[index]}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
