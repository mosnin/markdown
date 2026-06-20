import { type ReactNode } from "react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listRecentNotesByWorkspace } from "@/server/repositories/note_repository";
import { listWorkspacesByOwner } from "@/server/repositories/workspace_repository";
import { listWriteProposalsByWorkspace } from "@/server/repositories/write_proposal_repository";
import { FloatingShell } from "@/components/product/shell/floating_shell";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { AppBreadcrumbs } from "@/components/product/shell/app_breadcrumbs";
import { OperatorPanelTrigger } from "@/components/product/operator/operator_panel_trigger";
import { ActivityBell } from "@/components/product/activity_bell";
import { LegalStickyFooter } from "@/components/legal/legal_modal";
import { CommandPaletteProviderLoader } from "@/components/product/command_palette_provider_loader";
import { ToastProvider } from "@/components/product/toast_provider";
import { QuickActionsFab } from "@/components/product/quick_actions_fab";

/**
 * Authenticated app layout.
 *
 * Primary auth gate for the /app route tree. Verifies the session
 * server-side and bootstraps the workspace on first access. Loads the box
 * list, owned workspaces, recent notes, and pending-proposal count so the
 * navigation shell has real data on every route.
 *
 * Shell structure (the single global chrome is FloatingShell):
 *   [skip link]
 *   [FloatingShell:
 *      floating sidebar  ⇄  bottom dock   (desktop)
 *      mobile bottom tab bar + drawer     (mobile)
 *      └─ main column: [top bar] [<main id=main-content>] [legal footer] ]
 *
 * The top bar (breadcrumbs, operator panel, activity bell, Docs, theme
 * toggle) renders at the top of the main column in both nav modes. Mobile
 * navigation — primary routes + the collections/box tree — lives in the
 * FloatingShell's bottom tab bar and drawer, so there is exactly one shell
 * (no double-sidebar rendering).
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const [boxes, ownedWorkspaces, recentNotes, pendingProposals] = await Promise.all([
    listBoxesByWorkspace(supabase, ctx.workspace.id),
    listWorkspacesByOwner(supabase, ctx.user.id),
    listRecentNotesByWorkspace(supabase, ctx.workspace.id, {
      limit: 5,
      branchId: ctx.activeBranchId,
    }),
    listWriteProposalsByWorkspace(supabase, ctx.workspace.id, {
      status: "pending",
      limit: 100,
    }),
  ]);
  const pendingProposalsCount = pendingProposals.length;

  const userEmail = ctx.user?.email ?? "";
  const workspaceName = ctx.workspace.name;
  const workspaces = ownedWorkspaces.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
  }));

  // Strip heavy markdown before handing notes to client components. The
  // sidebar only needs identity + label + ordering key.
  const recentNotesMini = recentNotes.map((n) => ({
    id: n.id,
    title: n.title,
    box_id: n.box_id,
    updated_at: n.updated_at,
  }));

  return (
    <ToastProvider>
      <div className="h-full w-full overflow-hidden bg-background">
        {/* Skip to main content — visually hidden until focused (accessibility) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-4 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>

        {/* Single global chrome — floating sidebar ⇄ bottom dock + mobile bar */}
        <FloatingShell
          userEmail={userEmail}
          workspaceName={workspaceName}
          workspaceId={ctx.workspace.id}
          boxes={boxes}
          workspaces={workspaces}
          recentNotes={recentNotesMini}
          pendingProposalsCount={pendingProposalsCount}
        >
          {/* ── Top bar — remains in both nav modes ────────────────────────── */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/40 bg-background px-3 md:px-4">
            {/* Breadcrumb area (left) */}
            <div className="flex min-w-0 flex-1 items-center">
              <AppBreadcrumbs />
            </div>

            {/* Operator panel + activity + docs + theme (right) */}
            <div
              className="flex items-center gap-2"
              role="toolbar"
              aria-label="User actions"
            >
              <OperatorPanelTrigger
                boxes={boxes.map((b) => ({ id: b.id, name: b.name }))}
              />
              <ActivityBell />
              <a
                href="https://docs.contextstore.app"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden rounded text-xs text-foreground/50 transition-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline"
              >
                Docs
              </a>
              <ThemeToggle />
            </div>
          </header>

          {/* Page content — <main> landmark, scroll/overflow managed per-page.
              Extra bottom padding on mobile clears the fixed bottom tab bar. */}
          <main
            id="main-content"
            className="flex flex-1 flex-col overflow-hidden pb-16 lg:pb-0"
            tabIndex={-1}
          >
            {children}
          </main>

          {/* Sticky legal footer — clicking any link opens the full document in a modal */}
          <LegalStickyFooter />
        </FloatingShell>

        {/* Global Cmd/Ctrl+K command palette — renders a portal dialog */}
        <CommandPaletteProviderLoader />

        {/* Floating quick-actions surface — review queue (with live count),
            connect an agent, new box — reachable from any page. */}
        <QuickActionsFab pendingProposalsCount={pendingProposalsCount} />
      </div>
    </ToastProvider>
  );
}
