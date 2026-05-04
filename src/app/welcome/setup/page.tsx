"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { readProgress, type SetupStep } from "./_progress";

/**
 * Setup entry point.
 *
 * Reads localStorage for any in-flight progress and redirects to the
 * appropriate step. New users land on step 1. Returners pick up where
 * they left off — the StepIndicator on each step page lets them go back
 * if they want to revisit an earlier choice.
 *
 * Rendered as a client component because progress lives in localStorage;
 * a thin loader is shown for the (very brief) handoff.
 */
export default function SetupEntryPage() {
  const router = useRouter();

  useEffect(() => {
    const progress = readProgress();
    const step: SetupStep = progress.step ?? 1;
    router.replace(`/welcome/setup/step_${step}`);
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading setup…
      </div>
    </div>
  );
}
