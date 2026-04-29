import { type MilestoneStatus } from "@/lib/onboarding_milestones";

/**
 * Welcoming empty state shown when a workspace has zero notes and zero runs.
 *
 * The `milestones` prop is accepted for backward compatibility but ignored —
 * the checklist has been replaced by a single focused invitation.
 */

interface OnboardingMilestoneBarProps {
  milestones?: MilestoneStatus[];
}

export function OnboardingMilestoneBar(_props: OnboardingMilestoneBarProps) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border/60 px-6 py-8 text-center">
      <div>
        <p className="text-sm font-medium text-foreground">
          Ask Atlas AI to get started.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try: &quot;Summarize what I&apos;ve been working on&quot; or &quot;Help me draft a note about...&quot;
        </p>
      </div>
    </div>
  );
}
