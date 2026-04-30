import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Enterprise textarea.
 *
 * Mirrors the Input primitive: hairline border, `bg-card`, 6px radius, and
 * a brand-tinted focus ring. Default `min-h-[80px]` so callers don't have
 * to override on the common case.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-[80px] w-full",
        "rounded-md border border-input bg-card",
        "px-3 py-2 text-sm leading-relaxed text-foreground",
        "placeholder:text-foreground/40",
        "transition-[border-color,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "outline-none",
        "focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25",
        "md:text-sm",
        "dark:bg-card/60",
        "dark:disabled:bg-muted/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
