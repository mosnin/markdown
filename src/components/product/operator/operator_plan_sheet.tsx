"use client";

import { useState, type ReactNode } from "react";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";

/**
 * Mobile bottom-sheet "Plan & diff" affordance for the operator run-detail
 * route. Mirrors the dashboard's `<DashboardPlanSheetTrigger/>` pattern:
 *
 *  - The trigger is hidden entirely when the run is idle (terminal state) —
 *    matches the dashboard's behavior of not surfacing an empty pane on
 *    mobile. Desktop continues to render the right-rail unconditionally
 *    via the page's `lg:` layout, so this component is the *mobile* face
 *    of plan/diff only.
 *  - When in flight, the trigger pins to the bottom of the viewport at
 *    44px tall, full width minus a 16px gutter on each side, brand-yellow
 *    so it reads as the live action. 16px clear of the safe-area inset.
 *  - Tap opens a `<Sheet side="bottom">` capped at 85vh — the same
 *    visual contract the dashboard ships, so muscle memory transfers
 *    between the two surfaces. Swipe-to-dismiss falls out of the Sheet's
 *    default backdrop behavior; reduced-motion users get the Sheet's
 *    static fade variant via the primitive's `data-*` style hooks.
 *
 * The plan/diff body itself is owned by Agent A1's `<OperatorPlanRail/>`.
 * Until that lands, we render a placeholder Card so the surface is
 * wired end-to-end and the mobile UX can be validated independently.
 */

const IN_FLIGHT_STATUSES: ReadonlySet<WorkspaceOperatorRunRow["status"]> = new Set([
  "queued",
  "planning",
  "awaiting_approval",
  "executing",
]);

export interface OperatorPlanSheetProps {
  /**
   * The run currently being viewed. Drives the in-flight check so the
   * trigger only appears while the run can still produce events. Pass
   * the same `run` row the page already loaded — no extra fetch needed.
   */
  run: Pick<WorkspaceOperatorRunRow, "id" | "status">;
  /**
   * Optional override for the sheet body. Real callers pass the operator
   * plan/diff feed (Agent A1's `<OperatorPlanRail/>`); the placeholder
   * Card renders when omitted so the affordance is testable in isolation.
   */
  children?: ReactNode;
}

export function OperatorPlanSheet({ run, children }: OperatorPlanSheetProps) {
  const [open, setOpen] = useState(false);
  const inFlight = IN_FLIGHT_STATUSES.has(run.status);

  // Idle runs hide the trigger entirely — matches the dashboard pattern
  // (the desktop right-rail still shows the same content on `lg:`).
  if (!inFlight) return null;

  return (
    <>
      {/* Sticky bottom CTA — mobile-only. `pointer-events-none` on the
          wrapper lets the page underneath remain scrollable around the
          sticky region; the button itself re-enables pointer events. */}
      <div
        className={
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden"
        }
      >
        <Button
          variant="default"
          size="sm"
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="pointer-events-auto h-11 w-full shadow-lg"
        >
          <Activity aria-hidden="true" />
          Show plan
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85vh] w-full flex-col p-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle>Plan &amp; diff</SheetTitle>
            <SheetDescription>
              Live tool calls and proposed changes from this run.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {children ?? <OperatorPlanSheetPlaceholder />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Quiet stand-in for Agent A1's plan/diff feed. Replace the call site
 * once the real component lands; this Card exists so the bottom-sheet
 * is shippable on its own without blocking on the cross-agent handoff.
 */
function OperatorPlanSheetPlaceholder() {
  // TODO: replace with <OperatorPlanRail/> from A1 once it lands
  return (
    <Card size="sm" className="bg-muted/30">
      <div className="flex flex-col gap-1 px-4">
        <p className="text-overline text-muted-foreground">Plan &amp; diff</p>
        <p className="text-sm text-foreground">
          Plan and diff stream will render here.
        </p>
        <p className="text-xs text-muted-foreground">
          The desktop right-rail already shows this content; the mobile feed
          is wiring up.
        </p>
      </div>
    </Card>
  );
}
