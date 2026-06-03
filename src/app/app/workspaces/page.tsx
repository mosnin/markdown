import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listWorkspacesByOwner } from "@/server/repositories/workspace_repository";
import { PageHeader } from "@/components/product/page_header";
import { CreateBoxDialog } from "@/components/product/create/create_box_dialog";
import { WorkspaceLiveRefresh } from "@/components/product/workspace/workspace_live_refresh";
import { WorkspaceList } from "./workspace_list";
import { CreateWorkspaceButton } from "./create_workspace_button";
import { BoxList } from "./box_list";

// ─── Loading skeleton (exported for Suspense boundary use) ────────────────────

export function WorkspacesPageSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="skeleton h-6 w-32 rounded" />
            <div className="skeleton h-4 w-56 rounded" />
          </div>
          <div className="skeleton h-8 w-24 rounded" />
        </div>
      </div>
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
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Boxes are focused context domains — one per project, research area, or
        knowledge topic. They hold the notes and files a connected agent reads,
        then proposes changes to for you to approve in AI Edits.
      </p>
      <div className="mt-6">
        <CreateBoxDialog />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Want an agent to fill it for you?{" "}
        <Link
          href="/app/connect"
          className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          Connect an agent
        </Link>
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WorkspacesPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const [boxes, ownedWorkspaces] = await Promise.all([
    listBoxesByWorkspace(supabase, ctx.workspace.id),
    listWorkspacesByOwner(supabase, ctx.user.id),
  ]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkspaceLiveRefresh workspaceId={ctx.workspace.id} scope="workspace" />
      <PageHeader
        title="Workspaces"
        description="Manage your workspaces and browse the boxes inside the active one."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CreateWorkspaceButton />
            <CreateBoxDialog />
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 space-y-8">

          {/* Your workspaces section */}
          <section aria-label="Your workspaces" className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Your workspaces
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {ownedWorkspaces.length}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Each workspace is an independent container for boxes,
                  notes, files, skills, and agents. They never share content.
                </p>
              </div>
            </div>
            <WorkspaceList
              workspaces={ownedWorkspaces.map((w) => ({
                id: w.id,
                name: w.name,
                slug: w.slug,
                created_at: w.created_at,
              }))}
              activeWorkspaceId={ctx.workspace.id}
            />
          </section>

          {/* Boxes in the active workspace */}
          <section aria-label="Boxes">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Boxes in {ctx.workspace.name}
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

          <aside className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">About workspaces</p>
            <p className="mt-1 text-xs text-muted-foreground/80 leading-relaxed">
              You can own multiple workspaces. Switch the active workspace using
              the dropdown at the top of the sidebar. The active selection is
              persisted across sessions. Each workspace has its own boxes,
              folders, notes, files, skills, and agents — no content crosses a
              workspace boundary.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
