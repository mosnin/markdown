import { type ReactNode } from "react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listRecentNotesByWorkspace } from "@/server/repositories/note_repository";
import { listWorkspacesByOwner } from "@/server/repositories/workspace_repository";
import { listWriteProposalsByWorkspace } from "@/server/repositories/write_proposal_repository";
import { AppShellSidebar } from "@/components/product/shell/app_shell_sidebar";
import { MobileShellSidebar } from "@/components/product/shell/mobile_shell_sidebar";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { AppBreadcrumbs } from "@/components/product/shell/app_breadcrumbs";
import { OperatorPanelTrigger } from "@/components/product/operator/operator_panel_trigger";
import { ActivityBell } from "@/components/product/activity_bell";
import { LegalStickyFooter } from "@/components/legal/legal_modal";
import { CommandPaletteProviderLoader } from "@/components/product/command_palette_provider_loader";
import { CommandPaletteTopbarPill } from "@/components/product/command_palette_topbar_pill";
import { HotkeyProvider } from "@/components/product/hotkey_provider";
import { ToastProvider } from "@/components/product/toast_provider";

/**
 * Authenticated app layout.
 *
 * Primary auth gate for the /app route tree. Verifies the session
 * server-side and bootstraps the workspace on first access. Loads
 * the box list for the sidebar so every route in /app has real navigation.
 *
 * Shell structure:
 *   [skip link]
 *   [sidebar 240px | [top bar] [main content]]
 *
 * The top bar spans the content column on all screen sizes and contains:
 *   - Mobile: hamburger trigger + workspace name
 *   - Desktop: breadcrumb area (left) + theme toggle + user menu (right)
 *
 * The sidebar is desktop-only; mobile navigation uses a sheet drawer.
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
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Skip to main content — visually hidden until focused (accessibility) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-4 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background focus:shadow-lg focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        Skip to content
      </a>

      {/* Left sidebar — desktop only, fixed width with border separator */}
      <div className="hidden md:flex md:h-full md:shrink-0">
        <AppShellSidebar
          userEmail={userEmail}
          workspaceName={workspaceName}
          workspaceId={ctx.workspace.id}
          boxes={boxes}
          workspaces={workspaces}
          recentNotes={recentNotesMini}
          pendingProposalsCount={pendingProposalsCount}
        />
      </div>

      {/* Main content column — flex column filling remaining width */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* ── Top bar ──────────────────────────────────────────────────────────
            Mobile-first: pinned to the top of the column via `sticky top-0`
            so the hamburger + workspace name remain reachable while the
            page scrolls underneath. Single line, 48px tall (≤56px per
            mobile spec). On md+ the bar still occupies the same first
            row of the flex column — `sticky` is a no-op there because
            the column itself doesn't scroll. */}
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3 md:px-4">
          {/* Mobile: hamburger + workspace name */}
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <MobileShellSidebar
              userEmail={userEmail}
              workspaceName={workspaceName}
              workspaceId={ctx.workspace.id}
              boxes={boxes}
              workspaces={workspaces}
              pendingProposalsCount={pendingProposalsCount}
            />
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              {workspaceName ?? "Context Store"}
            </span>
          </div>

          {/* Desktop: breadcrumb area (left, intrinsic width) */}
          <div className="hidden md:flex md:items-center md:min-w-0 md:shrink">
            <AppBreadcrumbs />
          </div>

          {/* Command-palette pill — hidden on phones (<sm); the menu
              drawer's "Search" row is the mobile entry point so the
              topbar stays single-line and the workspace name has room
              to breathe at 375px. */}
          <div className="ml-auto hidden sm:flex sm:flex-1 sm:items-center sm:justify-center sm:px-4">
            <CommandPaletteTopbarPill variant="pill" />
          </div>

          {/* Desktop: quiet operator/activity/docs/theme toolbar (right) */}
          <div
            className="hidden md:flex md:items-center md:gap-1"
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
              className="inline-flex h-7 items-center justify-center rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              Docs
            </a>
            <ThemeToggle />
          </div>
        </header>

        {/* Page content — <main> landmark, scroll and overflow managed per-page */}
        <main
          id="main-content"
          className="flex flex-1 flex-col overflow-hidden"
          tabIndex={-1}
        >
          {children}
        </main>

        {/* Sticky legal footer — clicking any link opens the full document in a modal */}
        <LegalStickyFooter />
      </div>

      {/* Global Cmd/Ctrl+K command palette — renders a portal dialog */}
      <CommandPaletteProviderLoader />

      {/* Global keyboard chord runtime + cheatsheet Sheet (Move 1, Half A).
          Listens for `g h`, `c n`, `?`, etc. on `window` and dispatches the
          right router push or opens the cheatsheet. Single mount so every
          /app route inherits the bindings without re-registering. */}
      <HotkeyProvider />
    </div>
    </ToastProvider>
  );
}
