import { type ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/require_admin";
import { AdminNav } from "./admin_nav";

/**
 * Admin layout.
 *
 * Auth gate for the entire /admin route tree. requireAdmin() verifies the
 * session server-side and confirms the user's email is in ADMIN_EMAILS.
 * Any unauthenticated or non-admin request is redirected before rendering.
 *
 * Shell structure:
 *   [dark sidebar 240px | [top bar] [main content]]
 *
 * The dark sidebar signals clearly that this is a privileged admin area,
 * visually distinct from the regular /app shell.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireAdmin();
  const adminEmail = user.email ?? "";

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Left sidebar — dark, always visible ────────────────────────── */}
      <aside className="flex h-full w-60 shrink-0 flex-col bg-gray-900 text-white">
        {/* Sidebar header */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-4">
          <span className="inline-flex items-center rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
            Admin
          </span>
          <span className="text-sm font-semibold tracking-tight text-white/90">
            Context Store
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4" aria-label="Admin navigation">
          <AdminNav />
        </nav>

        {/* Sidebar footer — back to app link */}
        <div className="shrink-0 border-t border-white/10 p-4">
          <Link
            href="/app"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white/60 transition-fast hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to App
          </Link>
        </div>
      </aside>

      {/* ── Main content column ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 bg-background">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 bg-background px-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-700 dark:bg-red-900/30 dark:text-red-400">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{adminEmail}</span>
            <Link
              href="/app"
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Back to App
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main
          id="main-content"
          className="flex flex-1 flex-col overflow-auto"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
