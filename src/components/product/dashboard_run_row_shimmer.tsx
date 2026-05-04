"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Tiny client wrapper that paints the `.brand-shimmer` arrival wash on a
 * dashboard "Recent operator runs" row when the row is *fresh* — defined
 * as a `completed` status whose `created_at` is within the last
 * `FRESH_WINDOW_MS` at first mount.
 *
 * Why a wrapper, not inline:
 *   - The dashboard page itself is a server component, so we cannot use
 *     `Date.now()` or any client-only freshness check there without
 *     hydration drift.
 *   - The wrapper is intentionally minimal: it preserves the existing
 *     Card/Link structure, takes `children` as the row body, and only
 *     contributes the shimmer class. No layout, no extra DOM nesting.
 *
 * The CSS keyframe (`brand-shimmer-draw`) is a one-shot 600ms animation
 * that ends with `opacity: 0`, so the visual wash naturally clears
 * itself. We still drop the class after the animation window via
 * `useState` derived once at mount so that React doesn't re-trigger the
 * animation on subsequent re-renders (e.g. parent layout effects).
 *
 * Honors `prefers-reduced-motion` via the underlying CSS utility.
 */

const FRESH_WINDOW_MS = 5_000;

export function DashboardRunRowShimmer({
  status,
  createdAtIso,
  className,
  children,
}: {
  status: string;
  createdAtIso: string;
  className?: string;
  children: ReactNode;
}) {
  // Derive once at mount. Using a lazy initializer keeps this strictly
  // client-only and avoids running `Date.now()` during SSR.
  const [shouldShimmer] = useState<boolean>(() => {
    if (status !== "completed") return false;
    const ts = Date.parse(createdAtIso);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < FRESH_WINDOW_MS;
  });

  return (
    <div className={cn(shouldShimmer && "brand-shimmer", className)}>
      {children}
    </div>
  );
}
