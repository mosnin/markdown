"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

import { duration, ease } from "@/lib/motion";

/**
 * App-wide motion provider.
 *
 * - LazyMotion + domAnimation: ships only the DOM-targeted feature bundle
 *   (~5kb gzipped) instead of the full motion runtime; pages opt into the
 *   richer feature set on-demand if they ever need layout animations or
 *   gestures beyond what's in this bundle.
 * - MotionConfig: sets the global default tween so any unannotated
 *   `<motion.*>` element animates with the design-system curve, not
 *   motion's library default. Reduced-motion handling is handled by
 *   motion automatically once `reducedMotion="user"` is set — it respects
 *   `prefers-reduced-motion` per-user.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: duration.normal, ease: ease.standard }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
