"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { type SetupStep } from "./_progress";

interface StepIndicatorProps {
  /** The step that is currently active (1-indexed). */
  current: SetupStep;
}

const STEPS: ReadonlyArray<{ step: SetupStep; label: string; href: string }> = [
  { step: 1, label: "Start", href: "/welcome/setup/step_1" },
  { step: 2, label: "Note", href: "/welcome/setup/step_2" },
  { step: 3, label: "Bundle", href: "/welcome/setup/step_3" },
  { step: 4, label: "Try it", href: "/welcome/setup/step_4" },
] as const;

/**
 * Four pill segments at the top of every setup page.
 *
 *   - inactive  → bg-muted
 *   - active    → bg-brand
 *   - completed → bg-accent + text-muted-foreground
 *
 * Click-back is allowed for completed steps so the user can revise an
 * earlier choice without losing progress.
 */
export function StepIndicator({ current }: StepIndicatorProps) {
  return (
    <nav
      aria-label="Setup progress"
      className="flex items-center gap-2"
    >
      {STEPS.map(({ step, label, href }) => {
        const state =
          step === current ? "active" : step < current ? "done" : "inactive";
        const isLink = state === "done";
        const className = cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-fast",
          state === "active" && "bg-brand text-foreground shadow-xs",
          state === "done" &&
            "bg-accent text-muted-foreground hover:text-foreground",
          state === "inactive" && "bg-muted text-muted-foreground/70"
        );

        const inner = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold",
                state === "active" && "bg-foreground/10 text-foreground",
                state === "done" && "bg-background/60 text-foreground",
                state === "inactive" && "bg-background/40 text-muted-foreground"
              )}
            >
              {step}
            </span>
            {label}
          </>
        );

        return isLink ? (
          <Link
            key={step}
            href={href}
            className={className}
            aria-label={`Return to step ${step}: ${label}`}
          >
            {inner}
          </Link>
        ) : (
          <span
            key={step}
            className={className}
            aria-current={state === "active" ? "step" : undefined}
          >
            {inner}
          </span>
        );
      })}
    </nav>
  );
}
