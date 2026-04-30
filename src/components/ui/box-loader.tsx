"use client";

import { cn } from "@/lib/utils";

/**
 * BoxLoader — minimal indeterminate loader.
 *
 * The legacy 3D box-stack animation has been retired. The redesign uses a
 * quiet rotating arc on neutral border with a brand-subtle accent stop.
 * Honors `prefers-reduced-motion` by halting the spin. The exported
 * component name + signature are preserved so existing call sites are
 * unaffected.
 */
export function BoxLoader({ className }: { className?: string } = {}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-flex items-center justify-center",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          // 32px arc — 2px ring at 20% foreground, single brand quarter.
          "block size-8 animate-spin rounded-full border-2 border-foreground/20 border-t-brand motion-reduce:animate-none",
        )}
        style={{ animationDuration: "0.9s" }}
      />
    </div>
  );
}
