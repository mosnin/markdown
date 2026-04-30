import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * Enterprise input.
 *
 * Hairline border, subtle muted surface (slightly inset feel without an
 * actual inset shadow), 6px radius. Focus state lifts to a 2px brand-tinted
 * ring + brand-tinted border. Aria-invalid switches to destructive coloring.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0",
        "rounded-md border border-input bg-card",
        "px-3 py-1 text-sm leading-none text-foreground",
        "placeholder:text-foreground/40",
        "transition-[border-color,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "outline-none",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
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

export { Input }
