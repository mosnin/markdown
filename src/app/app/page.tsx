import Link from "next/link";
import { Box, FileText } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { PageHeader } from "@/components/product/page_header";
import { NoteStub } from "@/components/product/note_stub";
import { PanelSection } from "@/components/product/panel_section";
import { OnboardingCallout } from "@/components/product/onboarding_callout";
import { CreateBoxDialog } from "@/components/product/create_box_dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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

  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  // Collect recent notes across all boxes (up to 8)
  const notesByBox = await Promise.all(
    boxes.slice(0, 5).map((box) =>
      listNotesByBox(supabase, box.id, { limit: 10 })
    )
  );
  const allNotes = notesByBox
    .flat()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 8);

  const hasBoxes = boxes.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={ctx.workspace.name}
        description="Your context workspace."
        actions={hasBoxes ? <CreateBoxDialog /> : undefined}
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">

          {/* First-run onboarding — shown only when workspace has no boxes */}
          {!hasBoxes && <OnboardingCallout />}

          {/* Summary stats — shown once there's content */}
          {hasBoxes && (
            <section aria-label="Workspace summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                icon={Box}
                label="Boxes"
                value={boxes.length}
                href="/app/workspaces"
              />
              <StatCard
                icon={FileText}
                label="Recent notes"
                value={allNotes.length}
              />
            </section>
          )}

          {/* Box list — shown when boxes exist but no recent notes */}
          {hasBoxes && allNotes.length === 0 && (
            <PanelSection title="Boxes" noSeparator className="px-0">
              <ul className="flex flex-col gap-2 list-none">
                {boxes.map((box) => (
                  <li key={box.id}>
                    <Link
                      href={`/app/boxes/${box.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-fast hover:bg-accent/30"
                    >
                      <Box className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">
                          {box.name}
                        </p>
                        {box.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {box.description}
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}

          {/* Recent notes */}
          {allNotes.length > 0 && (
            <PanelSection title="Recent notes" noSeparator className="px-0">
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
            </PanelSection>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  href?: string;
}) {
  const inner = (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-2xl font-semibold tracking-tight text-foreground">
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
