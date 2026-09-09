import type { ReactNode } from "react";
import { NavSidebar } from "@/components/relay/nav-sidebar";

/**
 * The chassis: a navigation rail, and the canvas the page scrolls on.
 *
 * Deliberately simpler than the reference's collapsible variant. Poggle's rail
 * carries eight links, not a company's whole department tree, so the collapse
 * affordance would be chrome that solves a problem this product does not have.
 * The top bar is rendered by each page rather than here, because what belongs
 * in it — the breadcrumb, the page's own actions — is the page's business.
 */
export function AppShell({
  children,
  workspaceName,
}: {
  children: ReactNode;
  workspaceName: string;
}): ReactNode {
  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* The first tab stop on every app page: invisible until focused, then a
          real button, so a keyboard user skips the rail in one press. */}
      <a
        href="#main"
        className="t-caption-medium focus-ring-canvas sr-only rounded-8 border border-strong bg-raised px-4 text-ink outline-none focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:inline-flex focus:h-9 focus:items-center"
      >
        Skip to content
      </a>

      <NavSidebar workspaceName={workspaceName} />

      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <main
          id="main"
          tabIndex={-1}
          className="flex min-h-dvh flex-1 flex-col outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
