"use client";

import { AiChat } from "@/components/product/ai_chat";
import { OnboardingChecklist } from "@/components/product/onboarding_checklist";

export interface ConversationHomeClientProps {
  defaultBoxId?: string | null;
  /**
   * True when the workspace has no user-created context yet (a freshly
   * bootstrapped workspace, possibly with only the seeded starter box).
   * Surfaces the guided activation checklist above the prompt so a new user
   * is never staring at a bare input with no idea what to do.
   */
  isFirstRun?: boolean;
  /**
   * Real activation signals for the first-run checklist. `box` is always
   * false here (first-run means no user box yet); `agent` and `edit` reflect
   * whether an agent is connected and whether any proposal has been reviewed.
   */
  onboarding?: { agent: boolean; edit: boolean; pendingCount: number } | null;
}

export function ConversationHomeClient({
  isFirstRun = false,
  onboarding = null,
}: ConversationHomeClientProps) {
  return (
    <div className="flex flex-col h-full">
      {isFirstRun && onboarding && (
        <div className="border-b border-border bg-muted/20 px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <OnboardingChecklist
              box={false}
              agent={onboarding.agent}
              edit={onboarding.edit}
              pendingCount={onboarding.pendingCount}
            />
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <AiChat />
      </div>
    </div>
  );
}
