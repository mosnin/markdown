import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, Box, FileText, Inbox, Network } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listConnectionsByWorkspace } from "@/server/repositories/connection_repository";
import { listPendingProposals } from "@/server/repositories/write_proposal_repository";
import { listOperatorRuns } from "@/server/services/workspace_operator_runs_service";
import { listAuditEventsByWorkspace } from "@/server/repositories/audit_event_repository";
import { NoteStub } from "@/components/product/note_stub";
import { DashboardSection } from "@/components/product/dashboard_section";
import { DashboardCard } from "@/components/product/dashboard_card";
import { CreateBoxDialog } from "@/components/product/create_box_dialog";
import { OnboardingCallout } from "@/components/product/onboarding_callout";
import { QuickStartPanel } from "@/components/product/quick_start_panel";
import { OnboardingMilestoneBar } from "@/components/product/onboarding_milestone_bar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CONNECTION_STATUS } from "@/server/domain/constants/connection_constants";
import { formatRelativeDateShort } from "@/lib/format_date";
import { computeMilestones } from "@/lib/onboarding_milestones";

export default async function AppHomePage() {
  // Freeze "now" at server render so relative-date strings computed
  // further down are identical during client hydration. See
  // src/lib/format_date.ts.
  const nowIso = new Date().toISOString();
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  const [notesByBox, connections, pendingProposals, conversationRuns, bundleExportEvents] =
    await Promise.all([
      Promise.all(
        boxes.slice(0, 6).map((box) =>
          listNotesByBox(supabase, box.id, { limit: 6, branchId: ctx.activeBranchId })
        )
      ),
      listConnectionsByWorkspace(adminClient, ctx.workspace.id),
      listPendingProposals(adminClient, ctx.workspace.id, { limit: 20 }),
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

  const activeConnections = connections.filter(
    (c) => c.status === CONNECTION_STATUS.ACTIVE
  );
  const pendingCount = pendingProposals.length;
  const hasBoxes = boxes.length > 0;

  // Note links: count across all boxes fetched in notesByBox (first 6).
  // We use the notes we already have to determine if any links exist by
  // querying the note_links table for the workspace via a dedicated count query.
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

  // Derive a workspace-level note count: if allNotes has content, there's
  // at least one note. Use the flattened pre-slice array for accuracy within
  // the fetched set (first 6 boxes × 6 notes).
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
      {/* Workspace header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Image src="/logo-symbol-dark.png" alt="Poggle" width={28} height={28} className="rounded dark:hidden" />
            <Image src="/logo-symbol-light.png" alt="Poggle" width={28} height={28} className="rounded hidden dark:block" />
            <Image src="/logo-text-black.png" alt="Poggle" width={70} height={24} className="dark:hidden" />
            <Image src="/logo-text-white.png" alt="Poggle" width={70} height={24} className="hidden dark:block" />
          </div>
          <div className="h-6 w-px bg-border" />
          <div>
            <p className="text-xs text-muted-foreground">Workspace</p>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {ctx.workspace.name}
            </h1>
          </div>
        </div>
        {/* Header action slot intentionally empty — the canonical
            "New box" button lives next to the Boxes section below. */}
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">

          {/* Onboarding milestone bar — hidden once all done */}
          <Suspense fallback={<div className="animate-pulse h-10 rounded-lg bg-muted/20" />}>
            {!allMilestonesDone && (
              <OnboardingMilestoneBar milestones={milestones} />
            )}
          </Suspense>

          {/* First-run: no boxes */}
          {!hasBoxes && <OnboardingCallout />}

          {/* Quick start: boxes exist but no notes yet */}
          {hasBoxes && allNotes.length === 0 && (
            <QuickStartPanel firstBox={{ id: boxes[0].id, name: boxes[0].name }} />
          )}

          {/* Status row — only when there's content */}
          {hasBoxes && (
            <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted/20" />}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatusTile
                  icon={Box}
                  label="Boxes"
                  value={boxes.length}
                  href="/app/workspaces"
                />
                <StatusTile
                  icon={FileText}
                  label="Notes"
                  value={allNotes.length === 10 ? "10+" : allNotes.length}
                  href="/app/search"
                />
                <StatusTile
                  icon={Network}
                  label="Connections"
                  value={activeConnections.length}
                  href="/app/settings"
                  subdued={activeConnections.length === 0}
                />
                <StatusTile
                  icon={Inbox}
                  label="Pending proposals"
                  value={pendingCount}
                  href={pendingCount > 0 ? "/app/proposals" : undefined}
                  highlight={pendingCount > 0}
                />
              </div>
            </Suspense>
          )}

          {/* Recent notes */}
          <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted/20" />}>
            {allNotes.length > 0 && (
              <DashboardSection title="Recent notes">
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
              </DashboardSection>
            )}
          </Suspense>

          {/* Boxes — shown when there are boxes but no notes yet, or always as secondary */}
          <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted/20" />}>
            {hasBoxes && (
              <DashboardSection
                title="Boxes"
                description="Your knowledge containers"
                action={<CreateBoxDialog />}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {boxes.map((box) => (
                    <DashboardCard key={box.id} href={`/app/boxes/${box.id}`}>
                      <div className="flex items-start gap-3">
                        <Box
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">
                            {box.name}
                          </p>
                          {box.description && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {box.description}
                            </p>
                          )}
                          {box.guide_note_id && (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                              <BookOpen className="h-3 w-3" aria-hidden="true" />
                              <span>Guide note assigned</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </DashboardCard>
                  ))}
                </div>
              </DashboardSection>
            )}
          </Suspense>

          {/* Connections summary */}
          <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted/20" />}>
            {activeConnections.length > 0 && (
              <DashboardSection
                title="Active connections"
                description="External agents and integrations with access to this workspace"
                action={
                  <Link
                    href="/app/settings"
                    className="text-xs text-muted-foreground hover:text-foreground transition-fast"
                  >
                    Manage →
                  </Link>
                }
              >
                <div className="flex flex-col gap-1.5">
                  {activeConnections.slice(0, 4).map((conn) => (
                    <div
                      key={conn.id}
                      className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                    >
                      <Network className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground/80">
                          {conn.name}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px] font-normal capitalize">
                        {conn.permission_mode.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  ))}
                  {activeConnections.length > 4 && (
                    <p className="px-1 text-xs text-muted-foreground">
                      +{activeConnections.length - 4} more
                    </p>
                  )}
                </div>
              </DashboardSection>
            )}
          </Suspense>

          {/* Pending proposals callout */}
          <Suspense fallback={<div className="animate-pulse h-16 rounded-lg bg-muted/20" />}>
            {pendingCount > 0 && (
              <DashboardSection title="Pending review">
                <Link
                  href="/app/proposals"
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-fast hover:border-ring/50 hover:shadow-sm"
                >
                  <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {pendingCount} write proposal{pendingCount !== 1 ? "s" : ""} awaiting review
                    </p>
                    <p className="text-xs text-muted-foreground">
                      AI-generated changes need your approval before they apply.
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                    Review →
                  </Badge>
                </Link>
              </DashboardSection>
            )}
          </Suspense>

        </div>
      </ScrollArea>
    </div>
  );
}

// ─── StatusTile ───────────────────────────────────────────────────────────────

function StatusTile({
  icon: Icon,
  label,
  value,
  href,
  highlight,
  subdued,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  href?: string;
  highlight?: boolean;
  subdued?: boolean;
}) {
  const inner = (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-4 py-3 bg-card",
        highlight ? "border-warning/40 bg-warning/5" : "border-border"
      )}
    >
      <div className={cn(
        "flex items-center gap-1.5",
        highlight ? "text-warning" : "text-muted-foreground"
      )}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </div>
      <span
        className={cn(
          "text-2xl font-semibold tracking-tight",
          highlight ? "text-warning" : subdued ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="transition-fast hover:opacity-80">
        {inner}
      </Link>
    );
  }
  return inner;
}
