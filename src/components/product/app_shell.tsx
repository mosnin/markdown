import { type ReactNode } from "react";
import { type Box } from "@/server/domain/types/box";
import { AppSidebar } from "@/components/product/app_sidebar";

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
 * Pages that need a right panel embed it directly in their children
 * using a flex row layout — this keeps right-panel content scoped to
 * the route that needs it without requiring prop drilling through the shell.
 *
 * On mobile (< md), the sidebar is hidden.
 */
export function AppShell({
  children,
  userEmail,
  workspaceName,
  boxes = [],
}: AppShellProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Left sidebar — hidden on mobile */}
      <div className="hidden md:flex md:h-full md:shrink-0">
        <AppSidebar
          userEmail={userEmail}
          workspaceName={workspaceName}
          boxes={boxes}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
