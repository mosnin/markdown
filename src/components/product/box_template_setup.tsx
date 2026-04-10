"use client";

/**
 * BoxTemplateSetup — background template application for newly created boxes.
 *
 * Problem solved:
 *   Previously, applyBoxTemplateAction ran synchronously inside CreateBoxDialog
 *   before router.push() was called. A template with 2 folders + 3 notes takes
 *   800–1500ms to apply (sequential folder creates, note creates with versioning,
 *   audit events). That entire time was dead wait before the user saw any UI.
 *
 * Fix:
 *   CreateBoxDialog now navigates to the new box immediately after creation.
 *   If a template was selected, the template ID is passed as ?setup=<id> in the URL.
 *   This component detects that param on the box page and applies the template
 *   in the background while the user is already in the new box.
 *
 * Guards:
 *   - Only rendered by the box page when notes.length === 0 && folders.length === 0
 *     (server-side empty-box check prevents re-application to boxes with content).
 *   - useRef(didRun) prevents double-execution in React StrictMode or HMR.
 *
 * After success:
 *   router.replace('/app/boxes/${boxId}') navigates to the clean URL (no ?setup=),
 *   which triggers a fresh server render that shows the template content.
 *   Because the URL changes, the server re-executes the box page queries and
 *   BoxTemplateSetup is no longer rendered (the box is no longer empty).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { applyBoxTemplateAction } from "@/app/app/boxes/actions";

interface BoxTemplateSetupProps {
  boxId: string;
  templateId: string;
}

export function BoxTemplateSetup({ boxId, templateId }: BoxTemplateSetupProps) {
  const [failed, setFailed] = useState(false);
  const didRun = useRef(false);
  const router = useRouter();

  useEffect(() => {
    // Prevent double-execution (StrictMode, HMR, etc.)
    if (didRun.current) return;
    didRun.current = true;

    applyBoxTemplateAction(boxId, templateId).then((result) => {
      if (result.ok) {
        // Navigate to the clean URL — removes ?setup= and triggers a fresh
        // server render that shows the newly created template content.
        router.replace(`/app/boxes/${boxId}`);
      } else {
        // Template application failed. The box is still usable; the user
        // can create folders and notes manually. Log to console for debugging.
        console.error(
          `[BoxTemplateSetup] Template "${templateId}" failed for box ${boxId}: ${result.error}`
        );
        setFailed(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty — boxId/templateId are stable; effect is one-shot

  if (failed) {
    return (
      <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
        Template setup failed — your box is ready to use without it.
      </p>
    );
  }

  return (
    <p
      className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      Applying template…
    </p>
  );
}
