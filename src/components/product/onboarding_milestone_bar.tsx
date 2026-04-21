import { CheckCircle2, Circle } from "lucide-react";
import { type MilestoneStatus } from "@/lib/onboarding_milestones";
import { cn } from "@/lib/utils";

/**
 * Onboarding milestone progress bar.
 *
 * Compact one-row component shown on the dashboard to track first-time
 * user actions. Disappears once all 5 milestones are complete.
 *
 * Server component — milestone state is computed server-side.
 */

interface OnboardingMilestoneBarProps {
  milestones: MilestoneStatus[];
}

export function OnboardingMilestoneBar({ milestones }: OnboardingMilestoneBarProps) {
  const doneCount = milestones.filter((m) => m.done).length;
  const total = milestones.length;

  // Should not render when all done, but guard here too.
  if (doneCount === total) return null;

  return (
    <div
      className="rounded-lg border border-border bg-muted/30 px-4 py-3"
      role="region"
      aria-label="Getting started milestones"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Progress fraction label */}
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          <span className="text-foreground">{doneCount}</span>
          <span className="mx-0.5 text-muted-foreground/50">/</span>
          <span>{total}</span>
          <span className="ml-1">complete</span>
        </span>

        {/* Divider */}
        <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

        {/* Milestone chips */}
        <ol className="flex flex-wrap items-center gap-2" aria-label="Milestone list">
          {milestones.map((m) => (
            <li key={m.id}>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  m.done
                    ? "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                    : "border-border bg-background text-muted-foreground"
                )}
                aria-label={`${m.label}: ${m.done ? "complete" : "not yet done"}`}
              >
                {m.done ? (
                  <CheckCircle2
                    className="h-3 w-3 shrink-0 text-violet-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="h-3 w-3 shrink-0 text-muted-foreground/40"
                    aria-hidden="true"
                  />
                )}
                {m.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
