"use client";

import * as m from "motion/react-m";
import { useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";

// Pages that already carry their own motion — the conversation/chat home and
// the boxes bento dashboard — opt out so we don't double-animate them.
const NO_ANIMATION = new Set(["/app", "/app/boxes"]);

/**
 * Per-route entrance animation for the app's interior pages.
 *
 * Next.js `template.tsx` re-mounts on every navigation (unlike `layout.tsx`),
 * so each interior page fades in as you arrive — giving the app a more animated
 * feel without touching individual pages.
 *
 * Opacity-only by design: a `transform` (slide/scale) on this wrapper would
 * establish a containing block and break `position: fixed` descendants (the box
 * chat panel, quick-action FABs, etc.). A fade has no such side effect.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  // Chat/dashboard (and reduced-motion users): render untouched, no wrapper.
  if (reduce || NO_ANIMATION.has(pathname)) {
    return <>{children}</>;
  }

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="h-full"
    >
      {children}
    </m.div>
  );
}
