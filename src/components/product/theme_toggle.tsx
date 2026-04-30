"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Quiet icon-button toggle that swaps the document theme via next-themes.
 *
 * The Sun and Moon icons share a slot and crossfade in 200ms — no rotation,
 * no spin — to honor the redesign brief's "motion in service of meaning"
 * principle. Uses the ghost icon-sm variant so it sits flush in the topbar
 * toolbar and the sidebar bottom chrome without its own surface.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function toggle() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <Tooltip>
      {/* Base UI: use render prop instead of asChild */}
      <TooltipTrigger
        render={
          <button
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "relative text-muted-foreground hover:text-foreground"
            )}
            aria-label="Toggle theme"
            onClick={toggle}
          />
        }
      >
        <Sun
          className="h-4 w-4 scale-100 opacity-100 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-90 dark:opacity-0"
          aria-hidden="true"
        />
        <Moon
          className="absolute h-4 w-4 scale-90 opacity-0 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-100 dark:opacity-100"
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Toggle theme
      </TooltipContent>
    </Tooltip>
  );
}
