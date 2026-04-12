import { Building2 } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { PageHeader } from "@/components/product/page_header";
import { CreateBoxDialog } from "@/components/product/create_box_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace_live_refresh";
import { Badge } from "@/components/ui/badge";
import { BoxList } from "./box_list";

// ─── Loading skeleton (exported for Suspense boundary use) ────────────────────

export function WorkspacesPageSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header skeleton */}
      <div className="bg-background px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="skeleton h-6 w-32 rounded" />
            <div className="skeleton h-4 w-56 rounded" />
          </div>
          <div className="skeleton h-8 w-24 rounded" />
        </div>
      </div>

      {/* Card skeletons */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-4 space-y-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="skeleton h-4 w-40 rounded" />
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
              <div className="skeleton h-3 w-64 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyBoxes() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Building2 className="mb-4 h-12 w-12 text-muted-foreground/30" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">No boxes yet</h3>
      <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
        Boxes are focused context domains — one per project, research area, or knowledge topic.
      </p>
      <div className="mt-6">
        <CreateBoxDialog />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WorkspacesPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkspaceLiveRefresh workspaceId={ctx.workspace.id} scope="workspace" />
      <PageHeader
        title="Workspaces"
        description="Manage your workspace and browse all boxes in your context store."
        actions={<CreateBoxDialog />}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 space-y-6">

          {/* Workspace identity card */}
          <section
            aria-label="Workspace details"
            className="rounded-lg border border-border bg-card px-5 py-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Active workspace
                </p>
                <h2 className="text-base font-semibold text-foreground truncate">
                  {ctx.workspace.name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Slug:{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
                    {ctx.workspace.slug}
                  </code>
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-xs">
                Active
              </Badge>
            </div>
          </section>

          {/* Boxes section */}
          <section aria-label="Boxes">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                Boxes
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {boxes.length}
                </span>
              </h2>
            </div>

            {boxes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card">
                <EmptyBoxes />
              </div>
            ) : (
              <BoxList boxes={boxes} />
            )}
          </section>

          {/* V1 note */}
          <aside className="rounded-lg border border-border-subtle bg-muted/40 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">About this workspace</p>
            <p className="mt-1 text-xs text-muted-foreground/70 leading-relaxed">
              In V1, Context Store uses a single workspace per account. Your workspace
              contains all your boxes, folders, notes, and guides. Collaboration and
              multiple workspaces are not yet supported.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
