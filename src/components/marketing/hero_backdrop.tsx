"use client";

import * as React from "react";
import { Dithering } from "@paper-design/shaders-react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Ambient dithering-shader backdrop for the homepage hero.
 *
 * A single WebGL swirl rendered in the brand violet, pooled toward the
 * right/demo side and then knocked back behind a radial mask + gradient
 * scrims so it reads as atmosphere, never noise — the headline and the
 * interactive demo always stay crisp on top.
 *
 * Robustness:
 *   - Mounts the canvas only after hydration, so it never blocks first paint
 *     and can't cause an SSR/WebGL mismatch; it fades in once ready.
 *   - Respects reduced-motion by freezing the shader (speed 0) — the texture
 *     stays, the motion stops.
 *   - Purely decorative: aria-hidden and pointer-events-none.
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
      {/* The shader, masked to a soft circle and pooled toward the demo. */}
      <div
        className={cn(
          "absolute -top-1/4 left-1/2 aspect-square w-[150%] -translate-x-1/2 transition-opacity duration-[1200ms] ease-out sm:w-[120%] lg:left-[68%] lg:w-[85%]",
          mounted ? "opacity-100" : "opacity-0",
        )}
        style={{
          maskImage: "radial-gradient(closest-side, black 28%, transparent 76%)",
          WebkitMaskImage:
            "radial-gradient(closest-side, black 28%, transparent 76%)",
        }}
      >
        {mounted ? (
          <Dithering
            className="size-full opacity-60 mix-blend-screen"
            style={{ width: "100%", height: "100%" }}
            colorBack="#00000000"
            colorFront="#7c5cff"
            shape="swirl"
            type="4x4"
            size={2}
            scale={0.72}
            speed={reduceMotion ? 0 : 0.55}
          />
        ) : null}
      </div>

      {/* Legibility scrims: fade from the header, into the next section, and a
          centre vignette so text never competes with the swirl. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/30 to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_42%_42%,var(--color-background)_0%,transparent_55%)]" />
    </div>
  );
}
