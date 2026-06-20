"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

import { PixelGridShader } from "@/components/shaders/pixelgrid-shader";
import { cn } from "@/lib/utils";

/**
 * Ambient hero backdrop — a light-blue pixel-grid **ripple**.
 *
 * Concentric rings ripple out across a dithered pixel grid in sky blue, knocked
 * back behind a centre vignette so the headline and demo stay crisp, then faded
 * to the page background at the bottom (white in light mode) so it hands off
 * cleanly into the "compatible with" marquee beneath.
 *
 * Robustness:
 *   - Mounts the canvas only after hydration (no SSR canvas mismatch, never
 *     blocks first paint).
 *   - The shader is a CPU pixel loop, so we use a chunky pixel size and skip it
 *     entirely under reduced-motion — the scrims alone remain.
 *   - Decorative: aria-hidden + pointer-events-none (no pointer theft from CTAs).
 */
export function HeroBackdrop({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      {/* Light-blue ripple */}
      {mounted && !reduceMotion ? (
        <div className="absolute inset-0 opacity-90">
          <PixelGridShader
            shape="ripple"
            matrix="bayer8"
            colorFg="#7dd3fc"
            pxSize={5}
            amplitude={0.45}
            frequency={1}
            speed={0.45}
            rings={5}
          />
        </div>
      ) : null}

      {/* Soft legibility scrim — keeps the headline + demo crisp but lets the
          ripple read through. */}
      <div className="absolute inset-0 bg-background/35" />
      {/* Fade to the page background at the bottom → into the marquee below. */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
