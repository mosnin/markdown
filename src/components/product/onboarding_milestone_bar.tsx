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
  // Note: this used to be a milestone-chip checklist; it has since been
  // replaced by a single focused welcome card. If we ever bring chips
  // back, the row should be `flex snap-x snap-mandatory overflow-x-auto`
  // with each chip `min-w-[140px]` so it scrolls cleanly on a 375px
  // viewport (per Move 4 mobile spec).
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border/60 px-4 py-6 text-center sm:px-6 sm:py-8">
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
