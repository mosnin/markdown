"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Enterprise tabs — underline-style indicator.
 *
 * A 2px brand-yellow underline sits beneath the active tab. Inactive tabs
 * read in `text-muted-foreground`; the active tab is `text-foreground`.
 * No pill chrome, no background fill — type and content carry the page.
 */
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-3 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  [
    "group/tabs-list inline-flex w-fit items-center text-muted-foreground",
    "group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
    // Hairline rail under the row so the indicator reads as a single
    // continuous underline instead of floating in space.
    "group-data-horizontal/tabs:border-b group-data-horizontal/tabs:border-border",
    "group-data-vertical/tabs:border-l group-data-vertical/tabs:border-border",
    "gap-4",
  ].join(" "),
  {
    variants: {
      // The variant prop is preserved for back-compat. Both styles now
      // render the same underline treatment — there is no "pill" tab in
      // the redesigned system.
      variant: {
        default: "",
        line: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        // Layout
        "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
        "px-0.5 py-2 text-sm font-medium",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-3",
        // Resting / hover / active type colors
        "text-muted-foreground transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "hover:text-foreground",
        "data-active:text-foreground",
        // Disabled
        "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        // Focus
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:rounded-sm",
        // Icon sizing
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // 2px brand-yellow underline indicator (horizontal) — sits flush
        // with the bottom hairline rail. Vertical tabs surface a left
        // 2px brand bar instead.
        "after:pointer-events-none after:absolute after:bg-brand after:opacity-0 after:transition-opacity after:duration-150",
        "group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-px group-data-horizontal/tabs:after:h-0.5",
        "group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-left-px group-data-vertical/tabs:after:w-0.5",
        "data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
