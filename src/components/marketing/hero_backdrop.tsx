"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

import { PixelGridShader, type Shape } from "@/components/shaders/pixelgrid-shader";
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
export function HeroBackdrop({
  className,
  shape = "ripple",
  colorFg = "#7dd3fc",
  intensity = 0.9,
  scrimClassName = "bg-background/35",
  centerScrim = false,
}: {
  className?: string;
  shape?: Shape;
  colorFg?: string;
  /** Opacity of the shader layer (0–1). Lower it on pages where text sits
   *  directly over the field. @default 0.9 */
  intensity?: number;
  /** Flat legibility scrim laid over the whole field. @default bg-background/35 */
  scrimClassName?: string;
  /** Pool the page background behind centred hero text so it stays crisp.
   *  Use on interior pages whose headline sits on top of the field. */
  centerScrim?: boolean;
}) {
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
      {/* Pixel-grid shader (home: ripple/blue · interior pages: swirl/violet) */}
      {mounted && !reduceMotion ? (
        <div className="absolute inset-0" style={{ opacity: intensity }}>
          <PixelGridShader
            shape={shape}
            matrix="bayer8"
            colorFg={colorFg}
            pxSize={5}
            amplitude={0.45}
            frequency={1}
            speed={0.45}
            rings={5}
          />
        </div>
      ) : null}

      {/* Soft legibility scrim — keeps the headline + demo crisp but lets the
          field read through. */}
      <div className={cn("absolute inset-0", scrimClassName)} />

      {/* Centre vignette — pools the page background behind centred hero text so
          the headline + copy never fight the shader. */}
      {centerScrim && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(75% 65% at 50% 45%, var(--background) 0%, color-mix(in oklab, var(--background) 55%, transparent) 42%, transparent 80%)",
          }}
        />
      )}

      {/* Fade to the page background at the bottom → into the marquee below. */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
