"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

/**
 * A three-way theme control, built on the design language's segmented track:
 * the track sits a step below the canvas so the selected thumb reads as the
 * raised piece rather than an accent.
 *
 * Renders nothing until mounted. The server cannot know the viewer's theme, so
 * marking one option selected before hydration would flash the wrong one.
 */
export function ThemeToggle({ className }: { className?: string }): ReactNode {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-segment-track p-1",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              "focus-ring-canvas inline-flex size-7 items-center justify-center rounded-full outline-none transition-colors",
              selected
                ? "bg-segment-thumb text-ink shadow-sm"
                : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
