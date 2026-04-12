"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Animated glowing search bar.
 *
 * Fully rounded, dark input with yellow / amber conic-gradient glows that
 * rotate on hover and focus. Yellow palette matches the sitewide accent
 * (#FFDE21 and derivatives).
 *
 * Controlled component. Accepts value, onChange, placeholder, and standard
 * input props. Works as both the dashboard prompt input and the workspace
 * search input.
 *
 * Design notes
 *   - Every layer's before:bg-[conic-gradient(...)] carries yellow / amber
 *     stops against pure black so the glow reads as a warm halo instead
 *     of the original violet / pink halo.
 *   - Input itself is rounded-full. The inner blur layers are all
 *     rounded-full so the halo follows the pill shape.
 *   - The filter / clear affordance on the right is optional and off by
 *     default; callers wire their own slots via the `rightSlot` prop.
 */

export interface AnimatedGlowingSearchBarProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Optional right-side slot (icon / clear / filter button). */
  rightSlot?: React.ReactNode;
  /** Wrapper className — position the search bar inside a page. */
  wrapperClassName?: string;
  /** Input size preset. Defaults to "default" (56px tall). */
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
        "relative flex w-full items-center justify-center",
        wrapperClassName,
      )}
    >
      <div
        id="poda"
        className="group relative flex w-full max-w-[560px] items-center justify-center"
      >
        {/* Outer ring — main yellow/amber conic glow */}
        <div
          className={cn(
            "pointer-events-none absolute z-[-1] h-full w-full overflow-hidden rounded-full blur-[3px]",
            isSm ? "max-h-[52px]" : "max-h-[64px]",
            "before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[999px] before:w-[999px] before:-translate-x-1/2 before:-translate-y-1/2 before:rotate-60 before:bg-no-repeat before:content-['']",
            "before:bg-[conic-gradient(#000,#ffde21_5%,#000_38%,#000_50%,#ffaa00_60%,#000_87%)]",
            "before:transition-all before:duration-[2000ms]",
            "group-hover:before:rotate-[-120deg] group-focus-within:before:rotate-[420deg] group-focus-within:before:duration-[4000ms]",
          )}
        />

        {/* Secondary wash — softer amber layer */}
        <div
          className={cn(
            "pointer-events-none absolute z-[-1] h-full w-full overflow-hidden rounded-full blur-[3px]",
            isSm ? "max-h-[48px]" : "max-h-[60px]",
            "before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:rotate-[82deg] before:bg-no-repeat before:content-['']",
            "before:bg-[conic-gradient(rgba(0,0,0,0),#5a4400,rgba(0,0,0,0)_10%,rgba(0,0,0,0)_50%,#6a4f10,rgba(0,0,0,0)_60%)]",
            "before:transition-all before:duration-[2000ms]",
            "group-hover:before:rotate-[-98deg] group-focus-within:before:rotate-[442deg] group-focus-within:before:duration-[4000ms]",
          )}
        />

        {/* Pale highlight — warm cream/yellow edge shimmer */}
        <div
          className={cn(
            "pointer-events-none absolute z-[-1] h-full w-full overflow-hidden rounded-full blur-[2px]",
            isSm ? "max-h-[46px]" : "max-h-[58px]",
            "before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:rotate-[83deg] before:bg-no-repeat before:content-['']",
            "before:bg-[conic-gradient(rgba(0,0,0,0)_0%,#fff1b6,rgba(0,0,0,0)_8%,rgba(0,0,0,0)_50%,#ffdf7a,rgba(0,0,0,0)_58%)]",
            "before:brightness-[1.4] before:transition-all before:duration-[2000ms]",
            "group-hover:before:rotate-[-97deg] group-focus-within:before:rotate-[443deg] group-focus-within:before:duration-[4000ms]",
          )}
        />

        {/* Tight inner glow ring */}
        <div
          className={cn(
            "pointer-events-none absolute z-[-1] h-full w-full overflow-hidden rounded-full blur-[0.5px]",
            isSm ? "max-h-[44px]" : "max-h-[54px]",
            "before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[600px] before:w-[600px] before:-translate-x-1/2 before:-translate-y-1/2 before:rotate-70 before:bg-no-repeat before:content-['']",
            "before:bg-[conic-gradient(#1c1a10,#ffde21_5%,#1c1a10_14%,#1c1a10_50%,#ffaa00_60%,#1c1a10_64%)]",
            "before:brightness-[1.3] before:transition-all before:duration-[2000ms]",
            "group-hover:before:rotate-[-110deg] group-focus-within:before:rotate-[430deg] group-focus-within:before:duration-[4000ms]",
          )}
        />

        {/* Input surface */}
        <div id="main" className="group/input relative w-full">
          <input
            ref={ref}
            type="text"
            {...props}
            className={cn(
              "w-full border-none bg-[#0a0906] text-white placeholder-gray-400 focus:outline-none",
              isSm
                ? "h-[42px] rounded-full px-12 text-sm"
                : "h-[56px] rounded-full px-[52px] text-base md:text-lg",
              className,
            )}
          />

          {/* Fade mask on placeholder, hidden when focused */}
          <div
            id="input-mask"
            className={cn(
              "pointer-events-none absolute h-[20px] w-[100px] bg-gradient-to-r from-transparent to-[#0a0906]",
              "group-focus-within/input:hidden",
              isSm ? "left-[60px] top-[11px]" : "left-[70px] top-[18px]",
            )}
          />

          {/* Yellow accent blob — fades out on hover */}
          <div
            id="accent-blob"
            className={cn(
              "pointer-events-none absolute h-[20px] w-[30px] bg-[#ffde21] opacity-60 blur-2xl transition-all duration-[2000ms] group-hover:opacity-0",
              isSm ? "left-[5px] top-[6px]" : "left-[5px] top-[10px]",
            )}
          />

          {/* Search icon — left */}
          <div
            id="search-icon"
            className={cn(
              "pointer-events-none absolute flex items-center justify-center",
              isSm ? "left-4 top-[11px]" : "left-5 top-[15px]",
            )}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={isSm ? "20" : "24"}
              height={isSm ? "20" : "24"}
              viewBox="0 0 24 24"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
              className="feather feather-search"
            >
              <circle stroke="url(#agsb-search)" r="8" cy="11" cx="11" />
              <line
                stroke="url(#agsb-searchl)"
                y2="16.65"
                y1="22"
                x2="16.65"
                x1="22"
              />
              <defs>
                <linearGradient
                  gradientTransform="rotate(50)"
                  id="agsb-search"
                >
                  <stop stopColor="#fff6d6" offset="0%" />
                  <stop stopColor="#c9b976" offset="50%" />
                </linearGradient>
                <linearGradient id="agsb-searchl">
                  <stop stopColor="#c9b976" offset="0%" />
                  <stop stopColor="#86764a" offset="50%" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Optional right-side slot — clear button / filter / command chip.
              Rendered with the same dark-panel aesthetic so it reads as part
              of the input surface rather than a separate control. */}
          {rightSlot ? (
            <div
              className={cn(
                "absolute flex items-center justify-center",
                isSm ? "right-1.5 top-1.5" : "right-2 top-2",
              )}
            >
              {rightSlot}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export { AnimatedGlowingSearchBar };
export default AnimatedGlowingSearchBar;
