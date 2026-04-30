import { Suspense } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeDateShort } from "@/lib/format_date";
import { computeMilestones } from "@/lib/onboarding_milestones";

/**
 * Workspace home.
 *
 * Steady-state: a single column of recent notes, with one primary action
 * to create a new box. First-run state: an onboarding callout for users
 * with no boxes; a quickstart panel once boxes exist but notes don't; a
 * milestone bar that disappears the day every milestone is hit.
 *
 * Statistics, connection summaries, and pending-proposals callouts have
 * been removed: counts already live in the sidebar, and Activity / Audit
 * have their own pages. The home is for *opening what you were working
 * on*, not for inventory.
 */
export default async function AppHomePage() {
  // Freeze "now" at server render so relative-date strings computed
  // further down are identical during client hydration.
  const nowIso = new Date().toISOString();
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  const [notesByBox, conversationRuns, bundleExportEvents] = await Promise.all([
    Promise.all(
      boxes.slice(0, 6).map((box) =>
        listNotesByBox(supabase, box.id, { limit: 6, branchId: ctx.activeBranchId })
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
  const noteLinkCount = noteLinkCountData === null
    ? 0
    : (noteLinkCountData as unknown as number | null) ?? 0;

  const totalFetchedNoteCount = notesByBox.flat().length;

  const milestones = computeMilestones({
    noteCount: totalFetchedNoteCount,
    boxCount: boxes.length,
    conversationCount: conversationRuns.rows.length,
    linkCount: typeof noteLinkCount === "number" ? noteLinkCount : 0,
    bundleExportCount: bundleExportEvents.length,
  });
  const allMilestonesDone = milestones.every((m) => m.done);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={ctx.workspace.name}
        description="Pick up where you left off."
        actions={hasBoxes ? <CreateBoxDialog /> : undefined}
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
          {/* Onboarding milestone bar — hides when every milestone is hit. */}
          <Suspense fallback={<div className="animate-pulse h-10 rounded-lg bg-muted/20" />}>
            {!allMilestonesDone && (
              <OnboardingMilestoneBar milestones={milestones} />
            )}
          </Suspense>

          {/* First-run: no boxes yet → guided onboarding. */}
          {!hasBoxes && <OnboardingCallout />}

          {/* Boxes exist but no notes yet → quickstart prompt. */}
          {hasBoxes && allNotes.length === 0 && (
            <QuickStartPanel firstBox={{ id: boxes[0].id, name: boxes[0].name }} />
          )}

          {/* Recent notes — the steady-state view. */}
          <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted/20" />}>
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
                          updatedAt={formatRelativeDateShort(note.updated_at, nowIso)}
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
