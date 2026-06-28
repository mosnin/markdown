"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, useTransform, animate, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

interface CountUpProps {
  value: number;
  duration?: number;
  className?: string;
}

/**
 * Animated number count-up. Tweens from 0 → value on mount using motion.
 * Respects prefers-reduced-motion: shows the final value immediately when active.
 *
 * Ported from the reference dashboard's count-up; uses the project's
 * `motion/react-m` element namespace (LazyMotion) for the rendered span while
 * pulling the value/transform helpers from `motion/react`.
 */
export function CountUp({ value, duration = 1.4, className }: CountUpProps) {
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(reduce ? value : 0);
  const rounded = useTransform(motionValue, (v) => Math.round(v).toLocaleString());
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (reduce || hasAnimated.current) return;
    hasAnimated.current = true;
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, duration, motionValue, reduce]);

  return <m.span className={className}>{rounded}</m.span>;
}
