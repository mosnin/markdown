import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Enterprise button system.
 *
 * Brand yellow is the **primary** action color, applied flat with a hairline
 * darker yellow border, near-black text, and a subtle hover lift. No glass
 * gradient stack. Every variant prefers semantic tokens so light/dark modes
 * track automatically.
 *
 * All buttons share `rounded-full` shape — a deliberate signature carried over
 * from the previous design — paired with crisp 1px borders and 150ms motion.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center",
    "rounded-full border bg-clip-padding",
    "text-sm font-medium whitespace-nowrap",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
    "outline-none select-none",
    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:not(:disabled):translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary — flat brand yellow with hairline darker border, near-black
        // text. Hover lifts ever so slightly via shadow-xs and shifts to a
        // touch lighter; active settles back. This is the canonical CTA.
        default: [
          "border-[oklch(0.78_0.18_88)] bg-brand text-brand-foreground",
          "shadow-[inset_0_1px_0_0_color-mix(in_oklch,white_30%,transparent),0_1px_2px_0_color-mix(in_oklch,oklch(0.40_0.10_75)_25%,transparent)]",
          "hover:bg-[color-mix(in_oklch,var(--brand)_92%,white)] hover:shadow-[inset_0_1px_0_0_color-mix(in_oklch,white_40%,transparent),0_2px_6px_-1px_color-mix(in_oklch,oklch(0.40_0.10_75)_30%,transparent)]",
          "active:bg-[color-mix(in_oklch,var(--brand)_94%,black)]",
          "aria-expanded:bg-[color-mix(in_oklch,var(--brand)_92%,white)]",
        ].join(" "),

        // Secondary — neutral surface, foreground text.
        secondary: [
          "border-transparent bg-secondary text-secondary-foreground",
          "hover:bg-[color-mix(in_oklch,var(--secondary)_92%,var(--foreground))]",
          "aria-expanded:bg-[color-mix(in_oklch,var(--secondary)_92%,var(--foreground))]",
        ].join(" "),

        // Outline — transparent with hairline border. Quiet, rest-state default.
        outline: [
          "border-border bg-transparent text-foreground",
          "hover:bg-accent hover:text-accent-foreground",
          "aria-expanded:bg-accent aria-expanded:text-accent-foreground",
          "dark:bg-transparent",
        ].join(" "),

        // Ghost — chromeless until hover.
        ghost: [
          "border-transparent bg-transparent text-foreground",
          "hover:bg-accent hover:text-accent-foreground",
          "aria-expanded:bg-accent aria-expanded:text-accent-foreground",
          "dark:hover:bg-accent/60",
        ].join(" "),

        // Destructive — red-tinted, low-emphasis. Confirms a dangerous action
        // without screaming. Use only after a guard / dialog confirmation.
        destructive: [
          "border-transparent bg-destructive/10 text-destructive",
          "hover:bg-destructive/15",
          "focus-visible:ring-destructive/30",
          "dark:bg-destructive/15 dark:hover:bg-destructive/25",
        ].join(" "),

        // Link — inline text style.
        link: "border-transparent bg-transparent text-foreground underline-offset-4 hover:underline hover:text-foreground",

        // Subtle brand — for marketing or hero affordances where the brand
        // wants to whisper. Tinted background, brand foreground.
        "brand-subtle": [
          "border-brand/20 bg-brand/10 text-[color-mix(in_oklch,var(--brand)_60%,var(--foreground))]",
          "hover:bg-brand/15",
        ].join(" "),
      },
      size: {
        default: "h-9 gap-1.5 px-4 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-5 text-sm font-semibold has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xl: "h-11 gap-2 px-6 text-[15px] font-semibold has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "h-8 w-8 p-0",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
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
