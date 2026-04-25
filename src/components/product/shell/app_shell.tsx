import { type ReactNode } from "react";
import { type Box } from "@/server/domain/types/box";
import { AppSidebar } from "@/components/product/app_sidebar";
import { MobileSidebar } from "@/components/product/mobile_sidebar";
import { ErrorBoundary } from "@/components/ui/error_boundary";

interface AppShellProps {
  /** Main content area — may include an inline right panel */
  children: ReactNode;
  /** Authenticated user's email */
  userEmail?: string;
  /** Current workspace display name */
  workspaceName?: string;
  /** Boxes to show in the sidebar nav */
  boxes?: Box[];
}

/**
 * Root shell for all authenticated product views.
 *
 * Layout: [sidebar 224px] | [flex-1 children]
 *
 * On mobile (< md): sidebar is hidden. A top bar renders the workspace
 * name and a hamburger trigger for the MobileSidebar sheet.
 *
 * Pages that need a right panel embed it directly in their children
 * using a flex row layout — this keeps right-panel content scoped to
 * the route that needs it without prop drilling through the shell.
 */
export function AppShell({
  children,
  userEmail,
  workspaceName,
  boxes = [],
}: AppShellProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Skip to main content link — visually hidden until focused */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:left-4 focus:top-4 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      {/* Left sidebar — desktop only */}
      <div className="hidden md:flex md:h-full md:shrink-0">
        <AppSidebar
          userEmail={userEmail}
          workspaceName={workspaceName}
          boxes={boxes}
        />
      </div>

      {/* Main content column */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Mobile top bar — visible only on small screens */}
        <div className="flex md:hidden h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
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

        {/* Page content — wrapped in <main> for landmark semantics */}
        <main
          id="main-content"
          className="flex flex-1 flex-col overflow-hidden"
          tabIndex={-1}
        >
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
