import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Enterprise button — flat, restrained, sharp.
 *
 * Quiet Power overhaul replaces glass-button gradient with flat solid.
 * `rounded-md` (8px) for precise enterprise feel — no rounded-full pills
 * in app chrome (only avatars and count badges use pill radius).
 *
 * Hierarchy:
 *   default     — solid primary (near-black/white) — one per surface
 *   secondary   — bordered neutral fill — everyday actions
 *   outline     — transparent with ring — tertiary actions
 *   ghost       — transparent until hover — toolbars, icon buttons
 *   destructive — red-tinted — irreversible actions
 *   link        — inline text link, no chrome
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap outline-none select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary shadow-xs hover:bg-foreground/90 active:bg-foreground/95",
        secondary:
          "bg-card text-foreground border border-border hover:bg-muted hover:border-strong active:bg-secondary",
        outline:
          "bg-transparent text-foreground border border-border hover:bg-muted hover:border-strong active:bg-secondary",
        ghost:
          "bg-transparent text-foreground border border-transparent hover:bg-muted active:bg-secondary",
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 hover:border-destructive/30 active:bg-destructive/20 dark:bg-destructive/15 dark:hover:bg-destructive/20",
        link:
          "bg-transparent border border-transparent text-foreground underline-offset-4 hover:underline hover:text-iris",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
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
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
