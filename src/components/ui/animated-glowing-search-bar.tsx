"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Search input — formerly the "animated glowing" prompt bar.
 *
 * The redesign drops the rotating amber conic-gradient halos in favor of
 * a single quiet `<Input>` with a leading search icon and an optional
 * trailing slot. Prop signature is preserved so every existing call site
 * continues to compile and render — `wrapperClassName`, `rightSlot`, and
 * `size` ("default" | "sm") are honored.
 */
export interface AnimatedGlowingSearchBarProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Optional right-side slot (icon / clear / filter button). */
  rightSlot?: React.ReactNode;
  /** Wrapper className — position the search bar inside a page. */
  wrapperClassName?: string;
  /** Input size preset. Defaults to "default". */
  size?: "default" | "sm";
}

const AnimatedGlowingSearchBar = React.forwardRef<
  HTMLInputElement,
  AnimatedGlowingSearchBarProps
>(function AnimatedGlowingSearchBar(
  { className, wrapperClassName, rightSlot, size = "default", ...props },
  ref,
) {
  const isSm = size === "sm";

  return (
    <div
      className={cn(
        "relative flex w-full max-w-[560px] items-center",
        wrapperClassName,
      )}
    >
      <Search
        aria-hidden="true"
        strokeWidth={2}
        className={cn(
          "pointer-events-none absolute left-3 text-muted-foreground",
          isSm ? "h-4 w-4" : "h-4 w-4",
        )}
      />
      <Input
        ref={ref}
        type="search"
        // Match the standard Input visuals: hairline border, brand focus ring.
        // Add left padding for the leading icon and right padding when a slot
        // is rendered.
        className={cn(
          "w-full pl-9",
          rightSlot && "pr-10",
          isSm ? "h-9 text-sm" : "h-10 text-sm",
          className,
        )}
        {...props}
      />
      {rightSlot ? (
        <div className="absolute right-1.5 flex items-center justify-center">
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
});

export { AnimatedGlowingSearchBar };
export default AnimatedGlowingSearchBar;
