import { type ReactNode } from "react";
import { AppSidebar } from "@/components/product/app_sidebar";

interface AppShellProps {
  /** Main content area */
  children: ReactNode;
  /** Optional right panel — metadata, context, etc. */
  rightPanel?: ReactNode;
  /**
   * Authenticated user's email, threaded from the /app layout.
   * Passed to the sidebar for the user menu affordance.
   */
  userEmail?: string;
}

/**
 * Root shell for all authenticated product views.
 *
 * Layout:
 *   [sidebar 224px] | [main flex-1] | [right panel 280px?]
 *
 * The sidebar is fixed-width. The main area grows. The right panel
 * is optional and injected per-route via the rightPanel prop.
 *
 * On mobile (< md), the sidebar collapses to hidden and the right
 * panel is omitted. A sheet-based drawer handles mobile navigation
 * (wired in a later prompt).
 */
export function AppShell({ children, rightPanel, userEmail }: AppShellProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Left sidebar — hidden on mobile */}
      <div className="hidden md:flex md:h-full md:shrink-0">
        <AppSidebar userEmail={userEmail} />
      </div>

      {/* Main content + optional right panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* Right panel — optional, hidden on mobile */}
      {rightPanel && (
        <div className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background">
          {rightPanel}
        </div>
      )}
    </div>
  );
}
