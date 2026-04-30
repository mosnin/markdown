"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Legacy `GlassButton` — now a thin compatibility wrapper.
 *
 * The redesign drops the multi-layer glass DOM and gradient highlights in
 * favor of the flat brand-yellow primary defined by `<Button variant="default">`.
 * This module is kept around so existing imports and the existing prop
 * signature (`size`, `className`, `contentClassName`, `children`, native
 * button props) continue to compile and render. All instances now route to
 * the canonical Button component.
 *
 * `glassButtonVariants` is preserved as an export so any caller pulling it
 * for a `cn()` merge keeps working — but it now resolves to the Button's
 * `default` styling responsibilities and does not contribute multi-layer
 * chrome of its own.
 */
const glassButtonVariants = cva("", {
  variants: {
    size: {
      default: "",
      sm: "",
      lg: "",
      icon: "",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

// Map the legacy `size` vocabulary to the shared Button's size scale.
function mapSize(size?: VariantProps<typeof glassButtonVariants>["size"]) {
  switch (size) {
    case "sm":
      return "sm" as const;
    case "lg":
      return "lg" as const;
    case "icon":
      return "icon" as const;
    case "default":
    default:
      return "default" as const;
  }
}

export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof glassButtonVariants> {
  contentClassName?: string;
}

const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, children, size, contentClassName, ...props }, ref) => {
    return (
      <Button
        ref={ref as unknown as React.Ref<HTMLButtonElement>}
        // The shared Button uses Base UI's button primitive; HTML button
        // attributes still flow through unchanged.
        variant="default"
        size={mapSize(size)}
        className={cn(className)}
        {...(props as React.ComponentProps<typeof Button>)}
      >
        <span className={cn(contentClassName)}>{children}</span>
      </Button>
    );
  },
);
GlassButton.displayName = "GlassButton";

export { GlassButton, glassButtonVariants };
