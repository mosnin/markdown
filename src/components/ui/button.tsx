import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Enterprise button system.
 *
 * `default` is the canonical action — charcoal in light mode, near-white in
 * dark — bound to the `.btn-primary` class in globals.css. This is what
 * renders for every "Save / Create / Submit / Confirm" across the
 * authenticated app.
 *
 * `brand` is the deliberate brand spark — flat yellow, used for marketing
 * primary CTAs and a few signature moments where the brand should sing.
 * Bound to `.btn-brand`. Resist the urge to apply it broadly.
 *
 * Radius scales with size: `xs`/`sm` → `rounded-md`, `default`/`lg`/`xl` →
 * `rounded-lg`. Pill (`rounded-full`) is reserved for the dedicated `pill`
 * size, intended for chips and floating action affordances.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center",
    "border bg-clip-padding",
    "text-sm font-medium whitespace-nowrap",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
    "outline-none select-none",
    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary — charcoal. The canonical action across the app.
        default: "btn-primary",

        // Brand — flat yellow. Reserved for marketing CTAs and signature moments.
        brand: "btn-brand",

        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary/80",

        outline:
          "border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:bg-transparent",

        ghost:
          "border-transparent bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:hover:bg-accent/60",

        destructive:
          "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/30 dark:bg-destructive/15 dark:hover:bg-destructive/25",

        link: "border-transparent bg-transparent text-foreground underline-offset-4 hover:underline",

        "brand-subtle":
          "border-brand/20 bg-brand/10 text-foreground hover:bg-brand/15",
      },
      size: {
        default: "h-9 gap-1.5 rounded-lg px-4 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-md px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 rounded-lg px-5 text-sm font-semibold has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xl: "h-11 gap-2 rounded-lg px-6 text-[15px] font-semibold has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "h-8 w-8 rounded-md p-0",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-9 rounded-lg",
        // Pill — reserved for chips and floating affordances.
        pill: "h-8 gap-1.5 rounded-full px-3.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
