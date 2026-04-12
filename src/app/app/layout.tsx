import { type ReactNode } from "react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listWorkspacesByOwner } from "@/server/repositories/workspace_repository";
import { AppSidebar } from "@/components/product/app_sidebar";
import { MobileSidebar } from "@/components/product/mobile_sidebar";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { AppBreadcrumbs } from "@/components/product/app_breadcrumbs";
import { GlobalSearch } from "@/components/product/global_search";
import { LegalStickyFooter } from "@/components/legal/legal_modal";

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
  const [boxes, ownedWorkspaces] = await Promise.all([
    listBoxesByWorkspace(supabase, ctx.workspace.id),
    listWorkspacesByOwner(supabase, ctx.user.id),
  ]);

  const userEmail = ctx.user?.email ?? "";
  const workspaceName = ctx.workspace.name;
  const workspaces = ownedWorkspaces.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
  }));

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Skip to main content — visually hidden until focused (accessibility) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-4 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      {/* Left sidebar — desktop only, fixed width with border separator */}
      <div className="hidden md:flex md:h-full md:shrink-0">
        <AppSidebar
          userEmail={userEmail}
          workspaceName={workspaceName}
          workspaceId={ctx.workspace.id}
          boxes={boxes}
          workspaces={workspaces}
        />
      </div>

      {/* Main content column — flex column filling remaining width */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* ── Top bar ────────────────────────────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/40 bg-background px-3 md:px-4">
          {/* Mobile: hamburger + workspace name */}
          <div className="flex items-center gap-3 md:hidden">
            <MobileSidebar
              userEmail={userEmail}
              workspaceName={workspaceName}
              workspaceId={ctx.workspace.id}
              boxes={boxes}
              workspaces={workspaces}
            />
            <span className="text-sm font-semibold tracking-tight truncate">
              {workspaceName ?? "Context Store"}
            </span>
          </div>

          {/* Desktop: breadcrumb area (left) */}
          <div className="hidden md:flex md:flex-1 md:items-center md:min-w-0">
            <AppBreadcrumbs />
          </div>

          {/* Desktop: global search + utility links + theme toggle (right) */}
          <div
            className="hidden md:flex md:items-center md:gap-2 md:ml-auto"
            role="toolbar"
            aria-label="User actions"
          >
            <GlobalSearch boxes={boxes.map((b) => ({ id: b.id, name: b.name }))} />
            <a
              href="https://docs.contextstore.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-foreground/50 hover:text-foreground transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
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
    </div>
  );
}
