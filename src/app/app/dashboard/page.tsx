import { Suspense, type ComponentProps } from "react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listOperatorRuns } from "@/server/services/workspace_operator_runs_service";
import { listAuditEventsByWorkspace } from "@/server/repositories/audit_event_repository";
import { NoteStub } from "@/components/product/notes/note_stub";
import { CreateBoxDialog } from "@/components/product/create/create_box_dialog";
import { OnboardingCallout } from "@/components/product/onboarding_callout";
import { QuickStartPanel } from "@/components/product/quick_start_panel";
import { OnboardingMilestoneBar } from "@/components/product/onboarding_milestone_bar";
import { PageHeader } from "@/components/product/page_header";
import {
  DashboardOperatorProvider,
  DashboardPlanPanel,
  DashboardPlanSheetTrigger,
  type InFlightRun,
} from "@/components/product/dashboard_plan_panel";
import { DashboardOperatorPanel } from "@/components/product/dashboard_operator_panel";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeDateShort } from "@/lib/format_date";
import { computeMilestones } from "@/lib/onboarding_milestones";

// TODO: replace with shared isFeatureEnabled when Move 4 lands.
const operatorOnHome =
  process.env.NEXT_PUBLIC_FEATURE_OPERATOR_ON_HOME !== "false";

/**
 * Workspace home — Move 5.
 *
 * Reframes the dashboard around the Workspace Operator: the marquee
 * affordance is a single multimodal composer ("Ask Poggle to organize,
 * find, or build…"). The right-hand "Plan & diff" pane subscribes to
 * the most recent in-flight run via Realtime and surfaces tool calls,
 * plan steps, and proposed diffs as they arrive.
 *
 * The previous steady-state (recent notes) is preserved beneath the
 * composer; first-run states (no boxes / no notes) are unchanged so
 * Move 3's onboarding rewire still applies.
 *
 * Behind the `operator_on_home` feature flag — when off, falls back to
 * the prior simple recent-notes dashboard so we can dark-launch.
 */
export default async function AppHomePage() {
  // Freeze "now" at server render so relative-date strings computed
  // further down are identical during client hydration.
  const nowIso = new Date().toISOString();
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  const [notesByBox, conversationRuns, bundleExportEvents, recentRuns] =
    await Promise.all([
      Promise.all(
        boxes.slice(0, 6).map((box) =>
          listNotesByBox(supabase, box.id, {
            limit: 6,
            branchId: ctx.activeBranchId,
          })
        )
      ),
      listOperatorRuns(adminClient, {
        workspaceId: ctx.workspace.id,
        limit: 1,
      }),
      listAuditEventsByWorkspace(adminClient, ctx.workspace.id, {
        event_type: "bundle.exported",
        limit: 1,
      }),
      // Fetch the user's most recent operator runs so we can render
      // both the in-flight handoff for the right pane and the "Recent
      // operator runs" list under the composer in a single round-trip.
      listOperatorRuns(adminClient, {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        limit: 5,
      }),
    ]);

  const allNotes = notesByBox
    .flat()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 10);

  const hasBoxes = boxes.length > 0;

  // Note links: count across all boxes for the milestone calculation.
  const { data: noteLinkCountData } = await adminClient
    .from("note_links")
    .select("id", { count: "exact", head: true })
    .in(
      "source_note_id",
      notesByBox.flat().map((n) => n.id)
    );
  const noteLinkCount =
    noteLinkCountData === null
      ? 0
      : ((noteLinkCountData as unknown as number | null) ?? 0);

  const totalFetchedNoteCount = notesByBox.flat().length;

  const milestones = computeMilestones({
    noteCount: totalFetchedNoteCount,
    boxCount: boxes.length,
    conversationCount: conversationRuns.rows.length,
    linkCount: typeof noteLinkCount === "number" ? noteLinkCount : 0,
    bundleExportCount: bundleExportEvents.length,
  });
  const allMilestonesDone = milestones.every((m) => m.done);

  // The most recent in-flight run (if any) seeds the right-pane live feed.
  const IN_FLIGHT_STATUSES = new Set([
    "queued",
    "planning",
    "awaiting_approval",
    "executing",
  ]);
  const inFlight = recentRuns.rows.find((r) =>
    IN_FLIGHT_STATUSES.has(r.status)
  );
  const initialInFlightRun: InFlightRun | null = inFlight
    ? {
        id: inFlight.id,
        prompt: inFlight.prompt,
        status: inFlight.status,
        startedAtIso: inFlight.created_at,
      }
    : null;

  // Last 3 recent runs (any status) for the quiet "Recent operator runs"
  // section. Dedupe against the in-flight one when it's already pinned to
  // the right pane so we don't show it twice.
  const recentRunRows = recentRuns.rows
    .filter((r) => !inFlight || r.id !== inFlight.id)
    .slice(0, 3);

  // Feature-flag fallback: when operator-on-home is off, render the
  // previous recent-notes-only dashboard. Keeps the rollback path one
  // env var away.
  if (!operatorOnHome) {
    return (
      <LegacyDashboard
        ctx={ctx}
        hasBoxes={hasBoxes}
        allMilestonesDone={allMilestonesDone}
        milestones={milestones}
        allNotes={allNotes}
        boxes={boxes}
        nowIso={nowIso}
      />
    );
  }

  return (
    <DashboardOperatorProvider>
    <div className="flex h-full overflow-hidden">
      {/* Left pane — composer, recent notes, recent runs. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={ctx.workspace.name}
          description="Ask Poggle to organize, find, or build."
          actions={hasBoxes ? <CreateBoxDialog /> : undefined}
        />

        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
            {/* Onboarding milestone bar — hides when every milestone is hit. */}
            <Suspense
              fallback={
                <div className="animate-pulse h-10 rounded-lg bg-muted/20" />
              }
            >
              {!allMilestonesDone && (
                <OnboardingMilestoneBar milestones={milestones} />
              )}
            </Suspense>

            {/* First-run: no boxes yet → guided onboarding. */}
            {!hasBoxes && <OnboardingCallout />}

            {/* Boxes exist: show the operator composer as the marquee
                affordance. The composer's Run button is disabled until the
                user types something — `defaultBoxId` falls back to the
                first box so the action is always dispatchable. */}
            {hasBoxes && (
              <>
                <DashboardOperatorPanel defaultBoxId={boxes[0].id} />
                {/* Mobile-only "Show plan" affordance — surfaces the
                    right-pane sheet after a run is dispatched. */}
                <DashboardPlanSheetTrigger
                  hasAnyRun={initialInFlightRun !== null}
                />
              </>
            )}

            {/* Boxes exist but no notes yet → quickstart prompt. */}
            {hasBoxes && allNotes.length === 0 && (
              <QuickStartPanel
                firstBox={{ id: boxes[0].id, name: boxes[0].name }}
              />
            )}

            {/* Recent notes — the steady-state view. */}
            <Suspense
              fallback={
                <div className="animate-pulse h-32 rounded-lg bg-muted/20" />
              }
            >
              {allNotes.length > 0 && (
                <section aria-labelledby="recent-notes-heading">
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2
                      id="recent-notes-heading"
                      className="text-overline text-muted-foreground"
                    >
                      Recent
                    </h2>
                    <Link
                      href="/app/search"
                      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Search all notes →
                    </Link>
                  </div>
                  <ul className="flex flex-col gap-2 list-none">
                    {allNotes.map((note) => (
                      <li key={note.id}>
                        <Link
                          href={`/app/notes/${note.id}`}
                          className="block"
                        >
                          <NoteStub
                            title={note.title}
                            kind={note.kind as "note" | "guide" | "bundle"}
                            excerpt={note.summary ?? undefined}
                            updatedAt={formatRelativeDateShort(
                              note.updated_at,
                              nowIso
                            )}
                            tags={note.tags.slice(0, 3)}
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </Suspense>

            {/* Quiet "Recent operator runs" — last 3 rows for context. */}
            {hasBoxes && recentRunRows.length > 0 && (
              <section aria-labelledby="recent-runs-heading">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2
                    id="recent-runs-heading"
                    className="text-overline text-muted-foreground"
                  >
                    Recent operator runs
                  </h2>
                  <Link
                    href="/app/workspace_operator"
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    All runs →
                  </Link>
                </div>
                <ul className="flex flex-col gap-2 list-none">
                  {recentRunRows.map((run) => (
                    <li key={run.id}>
                      <Link
                        href={`/app/workspace_operator/${run.id}`}
                        className="block transition-colors hover:bg-accent/40 rounded-lg"
                      >
                        <Card size="sm" className="hover:shadow-xs">
                          <div className="flex items-center justify-between gap-3 px-4">
                            <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                              {run.prompt}
                            </p>
                            <div className="flex shrink-0 items-center gap-2">
                              <RunStatusBadge status={run.status} />
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                {formatRelativeDateShort(
                                  run.created_at,
                                  nowIso
                                )}
                              </span>
                            </div>
                          </div>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right pane (desktop) + mobile sheet — owned by the same
          provider so the composer's "I just ran X" handoff lights up
          the live event subscription instantly. */}
      {hasBoxes && (
        <DashboardPlanPanel initialInFlightRun={initialInFlightRun} />
      )}
    </div>
    </DashboardOperatorProvider>
  );
}

/**
 * Status badge for the "Recent operator runs" rows. Mirrors the status
 * pill mapping used in `operator_history_table.tsx`.
 */
function RunStatusBadge({ status }: { status: string }) {
  const variant: ComponentProps<typeof Badge>["variant"] =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "destructive"
        : status === "cancelled"
          ? "warning"
          : status === "awaiting_approval"
            ? "warning"
            : status === "executing" || status === "planning"
              ? "info"
              : "secondary";
  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}

// ---------------------------------------------------------------------------
// Legacy (flag-off) fallback
// ---------------------------------------------------------------------------

interface LegacyDashboardProps {
  ctx: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
  hasBoxes: boolean;
  allMilestonesDone: boolean;
  milestones: ReturnType<typeof computeMilestones>;
  allNotes: Array<{
    id: string;
    title: string;
    kind: string;
    summary: string | null;
    updated_at: string;
    tags: string[];
  }>;
  boxes: Array<{ id: string; name: string }>;
  nowIso: string;
}

function LegacyDashboard({
  ctx,
  hasBoxes,
  allMilestonesDone,
  milestones,
  allNotes,
  boxes,
  nowIso,
}: LegacyDashboardProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={ctx.workspace.name}
        description="Pick up where you left off."
        actions={hasBoxes ? <CreateBoxDialog /> : undefined}
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
          <Suspense
            fallback={
              <div className="animate-pulse h-10 rounded-lg bg-muted/20" />
            }
          >
            {!allMilestonesDone && (
              <OnboardingMilestoneBar milestones={milestones} />
            )}
          </Suspense>

          {!hasBoxes && <OnboardingCallout />}

          {hasBoxes && allNotes.length === 0 && (
            <QuickStartPanel
              firstBox={{ id: boxes[0].id, name: boxes[0].name }}
            />
          )}

          <Suspense
            fallback={
              <div className="animate-pulse h-32 rounded-lg bg-muted/20" />
            }
          >
            {allNotes.length > 0 && (
              <section aria-labelledby="recent-notes-heading">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2
                    id="recent-notes-heading"
                    className="text-overline text-muted-foreground"
                  >
                    Recent
                  </h2>
                  <Link
                    href="/app/search"
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Search all notes →
                  </Link>
                </div>
                <ul className="flex flex-col gap-2 list-none">
                  {allNotes.map((note) => (
                    <li key={note.id}>
                      <Link href={`/app/notes/${note.id}`} className="block">
                        <NoteStub
                          title={note.title}
                          kind={note.kind as "note" | "guide" | "bundle"}
                          excerpt={note.summary ?? undefined}
                          updatedAt={formatRelativeDateShort(
                            note.updated_at,
                            nowIso
                          )}
                          tags={note.tags.slice(0, 3)}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </Suspense>
        </div>
      </ScrollArea>
    </div>
  );
}
