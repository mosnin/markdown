"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@/lib/utils"

/**
 * Enterprise scroll area.
 *
 * Thin 6px thumb at `border-strong`, fully rounded. Track stays invisible —
 * the thumb itself only fades in while the area is hovered or actively
 * scrolling. No chunky rails, no permanent gutters.
 */
function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("group/scroll-area relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        // Thin (6px) gutter, transparent — only the thumb is rendered.
        // Visibility: opacity-0 by default, fade in on group hover or
        // while the user is scrolling.
        "flex touch-none select-none p-px transition-opacity duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        "data-horizontal:h-1.5 data-horizontal:flex-col",
        "data-vertical:h-full data-vertical:w-1.5",
        "opacity-0 group-hover/scroll-area:opacity-100 data-scrolling:opacity-100",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-[var(--border-strong)]"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
