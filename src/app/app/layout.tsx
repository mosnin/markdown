import { type ReactNode } from "react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { AppSidebar } from "@/components/product/app_sidebar";
import { MobileSidebar } from "@/components/product/mobile_sidebar";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { AppBreadcrumbs } from "@/components/product/app_breadcrumbs";

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
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  const userEmail = ctx.user?.email ?? "";
  const workspaceName = ctx.workspace.name;

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
          boxes={boxes}
        />
      </div>

      {/* Main content column — flex column filling remaining width */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* ── Top bar ────────────────────────────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3 md:px-4">
          {/* Mobile: hamburger + workspace name */}
          <div className="flex items-center gap-3 md:hidden">
            <MobileSidebar
              userEmail={userEmail}
              workspaceName={workspaceName}
              boxes={boxes}
            />
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-4 w-4 shrink-0 rounded-sm bg-foreground" aria-hidden="true" />
              <span className="text-sm font-semibold tracking-tight truncate">
                {workspaceName ?? "Context Store"}
              </span>
            </div>
          </div>

          {/* Desktop: breadcrumb area (left) */}
          <div className="hidden md:flex md:flex-1 md:items-center md:min-w-0">
            <AppBreadcrumbs />
          </div>

          {/* Desktop: user actions (right) — theme toggle + user avatar */}
          <div
            className="hidden md:flex md:items-center md:gap-1 md:ml-auto"
            role="toolbar"
            aria-label="User actions"
          >
            <ThemeToggle />
            {userEmail && (
              <UserMenu email={userEmail} />
            )}
          </div>
        </header>

        {/* Page content — <main> landmark with padding and scroll */}
        <main
          id="main-content"
          className="flex flex-1 flex-col overflow-auto"
          tabIndex={-1}
        >
          <div className="flex flex-1 flex-col p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
