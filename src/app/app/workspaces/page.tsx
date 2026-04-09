import Link from "next/link";
import { Box, FileText } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { PageHeader } from "@/components/product/page_header";
import { PanelSection } from "@/components/product/panel_section";
import { CreateBoxDialog } from "@/components/product/create_box_dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function WorkspacesPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Workspace"
        description={ctx.workspace.name}
        actions={<CreateBoxDialog />}
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-6 space-y-8">
          {/* Workspace identity */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {ctx.workspace.name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Workspace ID:{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    {ctx.workspace.id}
                  </code>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Slug: <code className="font-mono text-[11px]">{ctx.workspace.slug}</code>
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-xs">
                Active
              </Badge>
            </div>
          </section>

          {/* Boxes */}
          <PanelSection
            title={`Boxes (${boxes.length})`}
            noSeparator
            action={<CreateBoxDialog />}
            className="px-0"
          >
            {boxes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
                <p className="text-sm font-medium text-foreground">No boxes yet</p>
                <p className="mt-1 max-w-sm mx-auto text-sm text-muted-foreground">
                  Boxes are focused context domains — one per project, research area, or knowledge topic.
                </p>
                <div className="mt-4">
                  <CreateBoxDialog />
                </div>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
                {boxes.map((box) => (
                  <Link
                    key={box.id}
                    href={`/app/boxes/${box.id}`}
                    className="flex items-center gap-3 bg-card px-4 py-3 transition-fast hover:bg-accent/30"
                  >
                    <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {box.name}
                      </p>
                      {box.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {box.description}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(box.updated_at)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </PanelSection>

          {/* V1 concept note */}
          <div className="rounded-lg border border-border-subtle bg-muted/40 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              About this workspace
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              In V1, Context Store uses a single workspace per account. Your workspace
              contains all your boxes, folders, notes, and guides. Collaboration and
              multiple workspaces are not yet supported.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {["workspace", "box", "folder", "note", "guide"].map((term) => (
                <Badge
                  key={term}
                  variant="outline"
                  className="text-[10px] font-normal"
                >
                  {term}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
