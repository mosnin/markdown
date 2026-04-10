import Link from "next/link";
import { BookOpen, Box, FileText, Inbox, Network, Plus, Zap } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listConnectionsByWorkspace } from "@/server/repositories/connection_repository";
import { listPendingProposals } from "@/server/repositories/write_proposal_repository";
import { NoteStub } from "@/components/product/note_stub";
import { DashboardSection } from "@/components/product/dashboard_section";
import { DashboardCard } from "@/components/product/dashboard_card";
import { CreateBoxDialog } from "@/components/product/create_box_dialog";
import { OnboardingCallout } from "@/components/product/onboarding_callout";
import { QuickStartPanel } from "@/components/product/quick_start_panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CONNECTION_STATUS } from "@/server/domain/constants/connection_constants";

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function AppHomePage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  const [notesByBox, connections, pendingProposals] = await Promise.all([
    Promise.all(
      boxes.slice(0, 6).map((box) => listNotesByBox(supabase, box.id, { limit: 6 }))
    ),
    listConnectionsByWorkspace(adminClient, ctx.workspace.id),
    listPendingProposals(adminClient, ctx.workspace.id, { limit: 20 }),
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Workspace header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <p className="text-xs text-muted-foreground">Workspace</p>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {ctx.workspace.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {hasBoxes && <CreateBoxDialog />}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">

          {/* First-run: no boxes */}
          {!hasBoxes && <OnboardingCallout />}

          {/* Quick start: boxes exist but no notes yet */}
          {hasBoxes && allNotes.length === 0 && (
            <QuickStartPanel firstBox={{ id: boxes[0].id, name: boxes[0].name }} />
          )}

          {/* Status row — only when there's content */}
          {hasBoxes && (
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
                value={allNotes.length > 0 ? `${allNotes.length}+` : "0"}
              />
              <StatusTile
                icon={Zap}
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
          )}

          {/* Recent notes */}
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
                        updatedAt={formatRelativeDate(note.updated_at)}
                        tags={note.tags.slice(0, 3)}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </DashboardSection>
          )}

          {/* Boxes — shown when there are boxes but no notes yet, or always as secondary */}
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

          {/* Connections summary */}
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

          {/* Pending proposals callout */}
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
      className={`flex flex-col gap-1 rounded-lg border px-4 py-3 ${
        highlight
          ? "border-ring/40 bg-card"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </div>
      <span
        className={`text-2xl font-semibold tracking-tight ${
          highlight
            ? "text-foreground"
            : subdued
            ? "text-muted-foreground"
            : "text-foreground"
        }`}
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
