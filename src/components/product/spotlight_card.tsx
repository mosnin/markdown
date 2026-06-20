"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * A subtle spotlight card: a soft violet glow tracks the cursor on hover, with
 * a gentle lift and a top hairline. Quieter than a full gradient card — for
 * secondary surfaces like the boxes bento grid.
 *
 * Ported from the reference app's SpotlightCard and re-skinned to Poggle's
 * violet brand: the cursor glow is `rgba(139,92,246,α)` instead of the
 * reference's blue. Respects `prefers-reduced-motion` (no hover lift, and the
 * cursor tracking is skipped) for users who opt out of motion.
 */
export function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--y", `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-border bg-card transition-all duration-300",
        !reduce && "hover:-translate-y-1",
        "hover:border-border/80 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20",
        className
      )}
    >
      {/* Cursor-tracking violet glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(360px circle at var(--x) var(--y), rgba(139,92,246,0.12), transparent 60%)",
        }}
      />
      {/* Top hairline */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent dark:via-white/15"
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
