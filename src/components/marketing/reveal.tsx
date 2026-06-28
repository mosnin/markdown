"use client";

import * as React from "react";
import * as m from "motion/react-m";
import type { Variants } from "motion/react";

// ─── Scroll reveal ───────────────────────────────────────────────────────────
//
// The marketing site's one entrance gesture: a quiet fade + 16px rise as a
// block scrolls into view, once. Shared so every page breathes with the same
// rhythm. Reduced-motion users get the final state instantly (handled globally
// by MotionConfig reducedMotion="user").

export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export const revealTransition = { duration: 0.5, ease: [0.2, 0, 0, 1] as const };

export const revealViewport = { once: true, amount: 0.25 } as const;

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <m.div
      className={className}
      variants={revealVariants}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      transition={{ ...revealTransition, delay }}
    >
      {children}
    </m.div>
  );
}
