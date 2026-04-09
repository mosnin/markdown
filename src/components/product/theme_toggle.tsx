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
              buttonVariants({ variant: "ghost", size: "icon" }),
              "h-8 w-8 text-muted-foreground hover:text-foreground relative"
            )}
            aria-label="Toggle theme"
            onClick={toggle}
          />
        }
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        Toggle theme
      </TooltipContent>
    </Tooltip>
  );
}
