"use client";

import { LazyMotion, MotionConfig, domMax } from "motion/react";

import { duration, ease } from "@/lib/motion";

/**
 * App-wide motion provider.
 *
 * - LazyMotion + domMax: our own UI animates through the lazy-loaded `m.*`
 *   components, so a LazyMotion ancestor is required for any of it to work.
 *   We load the `domMax` feature bundle (gestures + layout + drag) because the
 *   richer surfaces across the app — morphing panels, the family button, the
 *   dynamic island, reorderable lists — rely on layout and drag animations
 *   that the leaner `domAnimation` bundle omits.
 * - No `strict`: several vendored UI primitives ship as full `motion.*`
 *   components rather than `m.*`. `strict` throws the moment one of those
 *   renders, so it would take down any page that uses them. Dropping it lets
 *   those primitives coexist with our `m.*` code; the LazyMotion bundle still
 *   keeps our own surface lean.
 * - MotionConfig: sets the global default tween so any unannotated
 *   `<motion.*>` element animates with the design-system curve, not
 *   motion's library default. Reduced-motion is handled by motion
 *   automatically once `reducedMotion="user"` is set — it respects
 *   `prefers-reduced-motion` per-user.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domMax}>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: duration.normal, ease: ease.standard }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
