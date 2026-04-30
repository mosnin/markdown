import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Enterprise badge — quiet, dense, semantic.
 *
 * Uppercase / overline-style is reserved for `tag` usage; the default badge
 * keeps the original case for status pills. Variants align with the status
 * tokens (success/warning/info/destructive) plus a subtle brand variant
 * for active/highlight pills used sparingly across the app.
 */
const badgeVariants = cva(
  [
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1",
    "overflow-hidden rounded-md border px-2 py-0",
    "text-[11px] font-medium leading-none whitespace-nowrap",
    "transition-colors duration-150",
    "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
    "[&>svg]:pointer-events-none [&>svg]:size-3!",
  ].join(" "),
  {
    variants: {
      variant: {
        // Default — neutral pill on muted background, used for counts / tags.
        default:
          "border-transparent bg-muted text-foreground/80 [a]:hover:bg-muted/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        outline:
          "border-border bg-transparent text-foreground [a]:hover:bg-muted",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "border-transparent text-foreground underline-offset-4 hover:underline",
        // Brand — flat brand-yellow pill for active / signature states.
        brand:
          "border-transparent bg-brand text-brand-foreground [a]:hover:bg-[color-mix(in_oklch,var(--brand)_92%,white)]",
        "brand-subtle":
          "border-brand/25 bg-brand/10 text-[color-mix(in_oklch,var(--brand)_55%,var(--foreground))] [a]:hover:bg-brand/15",
        success:
          "border-success/25 bg-success/10 text-success",
        warning:
          "border-warning/25 bg-warning/10 text-warning",
        info:
          "border-info/25 bg-info/10 text-info",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
