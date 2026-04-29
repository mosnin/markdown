import { type MilestoneStatus } from "@/lib/onboarding_milestones";

/**
 * Welcoming empty state shown when a workspace has zero notes and zero runs.
 *
 * The `milestones` prop is accepted for backward compatibility but ignored —
 * the checklist has been replaced by a single introductory card.
 */

interface OnboardingMilestoneBarProps {
  milestones?: MilestoneStatus[];
}

export function OnboardingMilestoneBar(_props: OnboardingMilestoneBarProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-8 py-10 text-center">
      <p className="text-sm font-medium text-foreground">Your workspace is ready.</p>
      <p className="text-xs text-muted-foreground max-w-sm">
        Start by writing a note, or ask the AI anything about your work.
      </p>
    </div>
  );
}
