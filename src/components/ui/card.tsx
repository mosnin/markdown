import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Enterprise card primitive.
 *
 * Flat at rest — no shadow. Hairline `border-border`, `bg-card`, `rounded-lg`.
 * Hover surfaces a quiet `shadow-xs` lift only when the card is interactive
 * (callers add `hover:shadow-xs` themselves where appropriate). Sizing is
 * driven by `data-size` so children automatically tighten padding for
 * dense lists. Footer surfaces a hairline divider above itself.
 */
function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col overflow-hidden",
        "rounded-lg border border-border bg-card text-card-foreground",
        "data-[size=default]:gap-4 data-[size=default]:py-5",
        "data-[size=sm]:gap-3 data-[size=sm]:py-4",
        "has-data-[slot=card-footer]:pb-0",
        "has-[>img:first-child]:pt-0",
        "*:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header",
        "grid auto-rows-min items-start gap-1",
        "rounded-t-lg",
        "group-data-[size=default]/card:px-5 group-data-[size=sm]/card:px-4",
        "pb-3",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        "has-data-[slot=card-description]:grid-rows-[auto_auto]",
        "[.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base font-semibold leading-tight tracking-tight",
        "group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn(
        "group-data-[size=default]/card:px-5 group-data-[size=sm]/card:px-4",
        className
      )}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-lg",
        "border-t border-border bg-muted/30",
        "group-data-[size=default]/card:px-5 group-data-[size=default]/card:py-3",
        "group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:py-2.5",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
