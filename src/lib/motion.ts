/**
 * Motion design system — Quiet Power.
 *
 * Single source of truth for every animation in Poggle. Every surface
 * imports its variants from here so the motion language stays coherent
 * across the app: same easing, same durations, same physics.
 *
 * Principles:
 *   1. Snappy, not floaty. Default duration is 200ms; nothing exceeds 420ms.
 *   2. Spring-based for hover/press, tween-based for entrances.
 *   3. Respect prefers-reduced-motion via the `MOTION_REDUCED` flag downstream.
 *   4. Every variant pairs with its CSS-token counterpart in globals.css so
 *      JS-driven and CSS-driven animations look identical.
 *
 * Use `motion/react` (Motion v12) — not framer-motion. Same API, smaller
 * bundle, better SSR.
 */

import type { Transition, Variants } from "motion/react"

// ─── Timing — mirrors --duration-* tokens in globals.css ──────────────────
export const duration = {
  instant: 0.08,
  fast: 0.14,
  normal: 0.2,
  slow: 0.28,
  deliberate: 0.42,
  page: 0.24,
} as const

// ─── Easing — mirrors --ease-* tokens in globals.css ──────────────────────
export const ease = {
  standard: [0.2, 0, 0, 1] as const,
  enter: [0, 0, 0.2, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
  emphasized: [0.32, 0.72, 0, 1] as const,
  spring: [0.34, 1.56, 0.64, 1] as const,
} as const

// ─── Spring presets — used for hover, press, drag ─────────────────────────
export const spring = {
  /** Snappy default — buttons, toggles, cards. */
  snappy: { type: "spring", stiffness: 380, damping: 30, mass: 0.8 } satisfies Transition,
  /** Gentle — sheets, drawers, larger surfaces. */
  gentle: { type: "spring", stiffness: 220, damping: 28, mass: 1 } satisfies Transition,
  /** Bouncy — rare, used for celebratory micro-moments only. */
  bouncy: { type: "spring", stiffness: 300, damping: 18, mass: 0.9 } satisfies Transition,
  /** Stiff — instantaneous-feeling, for tab indicators and active states. */
  stiff:  { type: "spring", stiffness: 500, damping: 38, mass: 0.6 } satisfies Transition,
} as const

// ─── Tween presets — used for entrances, exits, page transitions ──────────
export const tween = {
  fast:   { duration: duration.fast,   ease: ease.standard } satisfies Transition,
  normal: { duration: duration.normal, ease: ease.standard } satisfies Transition,
  enter:  { duration: duration.normal, ease: ease.enter }    satisfies Transition,
  exit:   { duration: duration.fast,   ease: ease.exit }     satisfies Transition,
  page:   { duration: duration.page,   ease: ease.emphasized } satisfies Transition,
} as const

// ─── Reusable variants ────────────────────────────────────────────────────

/** Fade in — most generic; use for static content reveal. */
export const fadeIn: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: tween.normal },
  exit:    { opacity: 0, transition: tween.exit },
}

/** Fade + 4px rise — the default for cards, list items, panels. */
export const fadeRise: Variants = {
  hidden:  { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: tween.normal },
  exit:    { opacity: 0, y: -4, transition: tween.exit },
}

/** Fade + 8px rise — heavier; use for hero blocks, page headers. */
export const fadeRiseHero: Variants = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { ...tween.page, ease: ease.emphasized } },
  exit:    { opacity: 0, y: -4, transition: tween.exit },
}

/** Slide in from the right — drawers, side panels, sheets. */
export const slideRight: Variants = {
  hidden:  { opacity: 0, x: 16 },
  visible: { opacity: 1, x: 0, transition: tween.normal },
  exit:    { opacity: 0, x: 16, transition: tween.exit },
}

/** Slide in from the bottom — bottom sheets, mobile drawers. */
export const slideUp: Variants = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: tween.normal },
  exit:    { opacity: 0, y: 16, transition: tween.exit },
}

/** Scale in — popovers, tooltips, dropdown menus. */
export const popIn: Variants = {
  hidden:  { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: spring.snappy },
  exit:    { opacity: 0, scale: 0.96, transition: tween.exit },
}

/** Modal entrance — paired with overlay fade. */
export const modalIn: Variants = {
  hidden:  { opacity: 0, scale: 0.97, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { ...tween.normal, ease: ease.emphasized } },
  exit:    { opacity: 0, scale: 0.98, y: 2, transition: tween.exit },
}

/** Crossfade — for tab content swaps, route transitions. */
export const crossfade: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.fast, ease: ease.standard } },
  exit:    { opacity: 0, transition: { duration: duration.instant, ease: ease.exit } },
}

// ─── Stagger containers ───────────────────────────────────────────────────

/** Stagger children entrance with default 40ms delay. Apply to a container. */
export const staggerContainer = (staggerChildren = 0.04, delayChildren = 0): Variants => ({
  hidden:  {},
  visible: {
    transition: { staggerChildren, delayChildren },
  },
})

/** Stagger out — for list collapses; faster than the in stagger. */
export const staggerContainerExit = (staggerChildren = 0.02): Variants => ({
  hidden: {
    transition: { staggerChildren, staggerDirection: -1 },
  },
})

// ─── Hover/press micro-interactions ───────────────────────────────────────

/** Lift on hover. Apply directly via `whileHover={hoverLift}`. */
export const hoverLift = {
  y: -1,
  transition: spring.snappy,
}

/** Press down on tap. Apply via `whileTap={tapPress}`. */
export const tapPress = {
  scale: 0.98,
  transition: spring.stiff,
}

/** Subtle scale-up — for icon-button hovers. */
export const hoverScale = {
  scale: 1.04,
  transition: spring.snappy,
}

// ─── Layout transition presets ────────────────────────────────────────────

/** Default layout transition — for `motion.div layout`. */
export const layoutTransition: Transition = spring.gentle

/** Tab indicator — sliding underline, segmented controls. */
export const tabIndicatorTransition: Transition = spring.stiff

// ─── Page transition wrapper props ────────────────────────────────────────

/** Spread on a `<motion.div>` wrapping page content for route transitions. */
export const pageTransitionProps = {
  initial: "hidden" as const,
  animate: "visible" as const,
  exit: "exit" as const,
  variants: fadeRise,
}

/** Stagger reveal wrapper — apply to lists/grids of items. */
export const listContainerProps = {
  initial: "hidden" as const,
  animate: "visible" as const,
  variants: staggerContainer(),
}

export const listItemProps = {
  variants: fadeRise,
}
