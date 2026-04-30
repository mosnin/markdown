import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Enterprise skeleton.
 *
 * `bg-muted` surface, `rounded-md` by default. Pass `circular` to swap to
 * `rounded-full` (avatars, dot indicators). The pulse animation is paused
 * for users who prefer reduced motion.
 */
function Skeleton({
  className,
  circular,
  ...props
}: React.ComponentProps<"div"> & { circular?: boolean }) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse bg-muted motion-reduce:animate-none",
        circular ? "rounded-full" : "rounded-md",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
