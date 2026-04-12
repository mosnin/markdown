"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Animated glowing search bar.
 *
 * Fully rounded input with yellow / amber conic-gradient glows that
 * rotate on hover and focus. Yellow palette matches the sitewide accent
 * (#FFDE21 and derivatives).
 *
 * Light / dark responsive:
 *   - Dark mode: near-black input surface (#0a0906) with white text;
 *     the yellow rings pop against the dark background.
 *   - Light mode: near-white input surface with dark text; the rings
 *     are deepened toward amber so they still read as a warm halo
 *     instead of disappearing into the page background. Soft drop-
 *     shadow replaces the dark glow.
 *
 * Controlled component. Accepts value, onChange, placeholder, and
 * standard input props. Works as both the dashboard prompt input and
 * the workspace search input.
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
        {/* Outer ring — main yellow/amber conic glow
            Dark: stops against pure black; Light: amber against white */}
        <div
          className={cn(
            "pointer-events-none absolute z-[-1] h-full w-full overflow-hidden rounded-full blur-[3px]",
            isSm ? "max-h-[52px]" : "max-h-[64px]",
            "before:absolute before:left-1/2 before:top-1/2 before:z-[-2] before:h-[999px] before:w-[999px] before:-translate-x-1/2 before:-translate-y-1/2 before:rotate-60 before:bg-no-repeat before:content-['']",
            "before:bg-[conic-gradient(#ffffff,#ffc400_5%,#ffffff_38%,#ffffff_50%,#f59e0b_60%,#ffffff_87%)]",
            "dark:before:bg-[conic-gradient(#000,#ffde21_5%,#000_38%,#000_50%,#ffaa00_60%,#000_87%)]",
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
            "before:bg-[conic-gradient(rgba(255,255,255,0),#f0c75e,rgba(255,255,255,0)_10%,rgba(255,255,255,0)_50%,#d4a84a,rgba(255,255,255,0)_60%)]",
            "dark:before:bg-[conic-gradient(rgba(0,0,0,0),#5a4400,rgba(0,0,0,0)_10%,rgba(0,0,0,0)_50%,#6a4f10,rgba(0,0,0,0)_60%)]",
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
            "before:bg-[conic-gradient(rgba(255,255,255,0)_0%,#fff6c8,rgba(255,255,255,0)_8%,rgba(255,255,255,0)_50%,#ffe088,rgba(255,255,255,0)_58%)]",
            "dark:before:bg-[conic-gradient(rgba(0,0,0,0)_0%,#fff1b6,rgba(0,0,0,0)_8%,rgba(0,0,0,0)_50%,#ffdf7a,rgba(0,0,0,0)_58%)]",
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
            "before:bg-[conic-gradient(#f6f3e8,#ffc400_5%,#f6f3e8_14%,#f6f3e8_50%,#f59e0b_60%,#f6f3e8_64%)]",
            "dark:before:bg-[conic-gradient(#1c1a10,#ffde21_5%,#1c1a10_14%,#1c1a10_50%,#ffaa00_60%,#1c1a10_64%)]",
            "before:brightness-[1.25] before:transition-all before:duration-[2000ms]",
            "group-hover:before:rotate-[-110deg] group-focus-within:before:rotate-[430deg] group-focus-within:before:duration-[4000ms]",
          )}
        />

        {/* Input surface — themed */}
        <div id="main" className="group/input relative w-full">
          <input
            ref={ref}
            type="text"
            {...props}
            className={cn(
              "w-full border-none focus:outline-none",
              // Light mode: near-white input, dark text, subtle shadow.
              // Dark mode: near-black input, white text.
              "bg-white text-foreground placeholder-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
              "dark:bg-[#0a0906] dark:text-white dark:placeholder-gray-400 dark:shadow-none",
              isSm
                ? "h-[42px] rounded-full px-12 text-sm"
                : "h-[56px] rounded-full px-[52px] text-base md:text-lg",
              className,
            )}
          />

          {/* Fade mask on placeholder, hidden when focused.
              Light: white fade. Dark: near-black fade. */}
          <div
            id="input-mask"
            className={cn(
              "pointer-events-none absolute h-[20px] w-[100px]",
              "bg-gradient-to-r from-transparent to-white",
              "dark:to-[#0a0906]",
              "group-focus-within/input:hidden",
              isSm ? "left-[60px] top-[11px]" : "left-[70px] top-[18px]",
            )}
          />

          {/* Yellow accent blob — fades out on hover */}
          <div
            id="accent-blob"
            className={cn(
              "pointer-events-none absolute h-[20px] w-[30px] bg-[#ffde21] blur-2xl transition-all duration-[2000ms] group-hover:opacity-0",
              "opacity-40 dark:opacity-60",
              isSm ? "left-[5px] top-[6px]" : "left-[5px] top-[10px]",
            )}
          />

          {/* Search icon — left. Gradient adapts to mode. */}
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
                {/* Gradients use CSS currentColor via a wrapper; SVG gradient
                    stops can't read Tailwind classes, so we pick mid-amber
                    tones that read well on both light and dark input surfaces. */}
                <linearGradient
                  gradientTransform="rotate(50)"
                  id="agsb-search"
                >
                  <stop stopColor="#d4a015" offset="0%" />
                  <stop stopColor="#a07a16" offset="50%" />
                </linearGradient>
                <linearGradient id="agsb-searchl">
                  <stop stopColor="#a07a16" offset="0%" />
                  <stop stopColor="#6b5212" offset="50%" />
                </linearGradient>
              </defs>
            </svg>
          </div>

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
