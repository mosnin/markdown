"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Activity, Sparkles, ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/product/empty_state";
import { EnhancedEventStream } from "@/components/product/enhanced_event_stream";
import { useOperatorEvents } from "@/lib/hooks/use_operator_events";

// ---------------------------------------------------------------------------
// Shared run-handoff context
// ---------------------------------------------------------------------------

export interface InFlightRun {
  id: string;
  prompt: string;
  status: string;
  startedAtIso: string;
}

interface DashboardOperatorContextValue {
  pendingRunId: string | null;
  setPendingRunId: (id: string | null) => void;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
}

const DashboardOperatorContext =
  createContext<DashboardOperatorContextValue | null>(null);

/**
 * Provider that owns the live "the user just dispatched run X" handoff
 * between the composer (left pane) and the plan panel (right pane).
 * Wrap the dashboard's two-pane layout in this so both client islands
 * read the same state without re-rendering everything in between.
 */
export function DashboardOperatorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const value = useMemo<DashboardOperatorContextValue>(
    () => ({
      pendingRunId,
      setPendingRunId,
      mobileSheetOpen,
      setMobileSheetOpen,
    }),
    [pendingRunId, mobileSheetOpen]
  );

  return (
    <DashboardOperatorContext.Provider value={value}>
      {children}
    </DashboardOperatorContext.Provider>
  );
}

export function useDashboardOperator(): DashboardOperatorContextValue {
  const ctx = useContext(DashboardOperatorContext);
  if (!ctx) {
    // Defensive default — keeps the composer functional in any preview
    // contexts that forget the provider. Real dashboard wraps both
    // panes so this branch is never hit in production.
    return {
      pendingRunId: null,
      setPendingRunId: () => {},
      mobileSheetOpen: false,
      setMobileSheetOpen: () => {},
    };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Right-pane "Plan & diff"
// ---------------------------------------------------------------------------

interface DashboardPlanPanelProps {
  /**
   * Most recent in-flight run for this user, fetched on the server. Seeds
   * the live event subscription on first render.
   */
  initialInFlightRun: InFlightRun | null;
}

/**
 * Right-pane "Plan & diff" feed.
 *
 * Subscribes to `useOperatorEvents` for the active run (a freshly-
 * dispatched run id from context wins over the most-recent in-flight one)
 * and surfaces tool calls / plan steps as they arrive. When no run is
 * active, falls back to a quiet empty state.
 *
 * The same body is also rendered inside a `<Sheet>` so the dashboard
 * can expose a "Show plan" affordance on mobile after a run starts.
 */
export function DashboardPlanPanel({
  initialInFlightRun,
}: DashboardPlanPanelProps) {
  const { pendingRunId, mobileSheetOpen, setMobileSheetOpen } =
    useDashboardOperator();

  const activeRunId = pendingRunId ?? initialInFlightRun?.id ?? null;
  const events = useOperatorEvents(activeRunId);

  const body = (
    <PlanPanelBody
      activeRunId={activeRunId}
      activePrompt={
        pendingRunId ? null : initialInFlightRun?.prompt ?? null
      }
      events={events}
      activeStatus={
        pendingRunId ? "executing" : initialInFlightRun?.status ?? null
      }
    />
  );

  return (
    <>
      {/* Desktop pane — hidden on mobile. */}
      <aside
        aria-label="Plan and diff"
        className="hidden lg:flex w-[420px] shrink-0 flex-col border-l border-border bg-background"
      >
        {body}
      </aside>

      {/* Mobile sheet — opens when the user submits a run.
          `side="bottom"` so the sheet rises from the bottom on phones,
          which feels native and is drag-to-dismiss-friendly via the
          backdrop. The body is height-capped to ~85vh so the page below
          remains visible at the top edge as a visual handle. */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85vh] w-full flex-col p-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle>Plan &amp; diff</SheetTitle>
            <SheetDescription>
              Live tool calls and proposed changes from the operator.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

interface PlanPanelBodyProps {
  activeRunId: string | null;
  activePrompt: string | null;
  activeStatus: string | null;
  events: ReturnType<typeof useOperatorEvents>;
}

function PlanPanelBody({
  activeRunId,
  activePrompt,
  activeStatus,
  events,
}: PlanPanelBodyProps) {
  const hasEvents = events.length > 0;

  if (!activeRunId) {
    return (
      <div className="flex h-full flex-col">
        <PaneHeader label="Plan & diff" status={null} />
        <div className="flex-1 overflow-hidden">
          <EmptyState
            icon={<Sparkles aria-hidden="true" />}
            title="Plans appear here when an agent is running."
            description="Try a prompt on the left."
            size="default"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PaneHeader label="Plan & diff" status={activeStatus} />
      <div className="px-4 pt-4 sm:px-5">
        <Card size="sm" className="bg-muted/30">
          <div className="px-4">
            <p className="text-overline text-muted-foreground">Active run</p>
            {/* Long prompts truncate to 2 lines on mobile so the card
                stays predictable on a 375px viewport, then expand to 3
                lines at md+ where vertical real-estate is cheap. */}
            <p className="mt-1.5 line-clamp-2 text-sm text-foreground md:line-clamp-3">
              {activePrompt ?? "Run dispatched. Awaiting first event…"}
            </p>
            {/* Status / action row — wraps onto a second line on narrow
                widths so the "Live" chip never gets clipped behind the
                Open-run link. */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Badge variant="info" className="shrink-0">
                <Activity className="size-3" aria-hidden="true" />
                Live
              </Badge>
              <Button
                variant="link"
                size="sm"
                className="shrink-0"
                render={
                  <Link href={`/app/workspace_operator/${activeRunId}`} />
                }
              >
                Open run
                <ArrowUpRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 flex-1 overflow-hidden border-t border-border">
        {hasEvents ? (
          <EnhancedEventStream
            events={events}
            autoScroll
            contain
            className="h-full"
          />
        ) : (
          <EmptyState
            icon={<Activity aria-hidden="true" />}
            title="Waiting for the agent…"
            description="The first plan step or tool call will appear here."
            size="sm"
          />
        )}
      </div>
    </div>
  );
}

function PaneHeader({
  label,
  status,
}: {
  label: string;
  status: string | null;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3.5 sm:px-5">
      <p className="text-overline text-muted-foreground">{label}</p>
      {status && status !== "completed" && status !== "failed" && (
        <Badge variant="info">{status.replace(/_/g, " ")}</Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Show plan" trigger (mobile-only)
// ---------------------------------------------------------------------------

/**
 * Mobile-only button that surfaces the right-pane sheet after a run has
 * been kicked off. Hidden on `lg+` because the desktop pane is always
 * visible.
 *
 * Behavior is two-fold:
 *  - When there's nothing to show (no run dispatched in this session and
 *    no in-flight run from the server), the trigger is rendered disabled
 *    in-flow as a quiet hint — the user knows the surface exists but
 *    can't tap into an empty pane.
 *  - When a run exists, it pins to the bottom of the viewport as a
 *    44px-tall sticky CTA, 16px clear of the safe-area inset, so it
 *    stays reachable while the user scrolls the composer + recent feed.
 */
export function DashboardPlanSheetTrigger({
  hasAnyRun,
}: {
  hasAnyRun: boolean;
}) {
  const { setMobileSheetOpen, pendingRunId } = useDashboardOperator();
  const visible = hasAnyRun || pendingRunId !== null;

  if (!visible) {
    // Quiet disabled affordance — keeps layout stable so the page
    // doesn't jump once the first run lands.
    return (
      <div className="flex lg:hidden">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled
          aria-disabled="true"
          className="h-11"
        >
          <Activity aria-hidden="true" />
          Show plan
        </Button>
      </div>
    );
  }

  return (
    <div
      className={
        // Sticky to the bottom of the viewport on mobile, hidden on lg+.
        // `pointer-events-none` on the wrapper + `pointer-events-auto`
        // on the button lets the user keep scrolling through the page
        // even where the sticky CTA sits.
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden"
      }
    >
      <Button
        variant="default"
        size="sm"
        type="button"
        onClick={() => setMobileSheetOpen(true)}
        className="pointer-events-auto h-11 w-full max-w-sm shadow-lg"
      >
        <Activity aria-hidden="true" />
        Show plan
      </Button>
    </div>
  );
}

